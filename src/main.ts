'use strict';
require('dotenv').config();
import {WebSocket} from 'ws';

import {dateToLocaleTimeString, indexOfMax, log, log_level} from "./helpers";
import alertTypes from './static/alerts.json';
import {AlertData, CONTINENTS, PS2EventMessage, STATUSES, WORLDS} from './data';

// =========  Init Discord  =========
import {Client, EmbedBuilder, IntentsBitField, Message, TextChannel} from 'discord.js';
// =========  Env  =========
import {CHANNEL_ID, DEBUG_CHANNEL_ID, REJECT_UNAUTHORIZED, TOKEN, URI} from './environment_vars';

const myIntents = new IntentsBitField();
myIntents.add(
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildEmojisAndStickers,
    IntentsBitField.Flags.GuildMembers
);
const bot: Client = new Client({intents: myIntents});

// =========  Globals  =========
let CHANNEL: TextChannel;
let DEBUG_CHANNEL: TextChannel;
let ps2Socket: WebSocket;
let isTracking = false;
const curAlerts: Map<string, Message> = new Map();

// time in UTC
const START_DATE = new Date();
START_DATE.setHours(17, 30, 0, 0);
const END_DATE = new Date();
END_DATE.setHours(22, 0, 0, 0);


// =========  Bot Launch  =========
bot.on('ready', async () => {
    CHANNEL = await bot.channels.fetch(CHANNEL_ID) as TextChannel;
    DEBUG_CHANNEL = await bot.channels.fetch(DEBUG_CHANNEL_ID) as TextChannel;

    log(`Logged in as ${bot.user?.tag}!`);
    bot.user?.setPresence(STATUSES.IDLE);

    checkTime();
});
bot.on('error', err => {
    log(err.message);
});


// =========  Functions  =========
function connect(): void {
    ps2Socket = new WebSocket(URI, {"rejectUnauthorized": REJECT_UNAUTHORIZED});

    ps2Socket.onopen = (_) => {
        log('Client Connected');
        isTracking = true;

        let subscribe_msg = {
            "service": "event",
            "action": "subscribe",
            "worlds": [WORLDS["Cobalt"]],
            "eventNames": ["MetagameEvent"]
        };

        ps2Socket.send(JSON.stringify(subscribe_msg));
    };

    ps2Socket.onclose = _ => {
        isTracking = false;
        log('Connection Closed');
    };

    ps2Socket.onerror = event => {
        isTracking = false;
        bot.user?.setPresence(STATUSES.ERROR);
        log("Connection Error: \n" + event.error.message + "\n" + event.error.stack, log_level.error);
        setTimeout(checkTime, 600_000);
    };

    ps2Socket.onmessage = async (message) => {
        let jsonData: PS2EventMessage = JSON.parse(message.data.toString());

        switch (jsonData.type) {
            case "serviceMessage":
                let event_id = parseInt(jsonData.payload.metagame_event_id)
                if (event_id >= 227 || event_id <= 106
                    || (event_id >= 159 && event_id <= 175)
                    || (event_id >= 180 && event_id <= 183)
                    || (event_id >= 194 && event_id <= 207)
                ) {
                    return; // Ignore special events
                }
                // Post Alert
                if (jsonData.payload.metagame_event_state_name == "started") {
                    if (!isTracking) { // Ignore of not tracking anymore
                        return;
                    }

                    try {
                        let msg = await CHANNEL.send({embeds: [jsonToEmbed(jsonData.payload)]});
                        curAlerts.set(jsonData.payload.instance_id, msg);
                        log(`New Alert (id = ${jsonData.payload.instance_id}): \n'${message.data}'`);
                    } catch (error) {
                        if (typeof error === "string") {
                            await DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\``);
                        } else if (error instanceof Error) {
                            await DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\`\n\`${error.stack}\``);
                        }
                        console.error("Unexpected Error parsing alert-data:");
                        console.error(jsonData);
                        throw error;
                    }
                } else if (jsonData.payload.metagame_event_state_name == "ended") {
                    let msg = curAlerts.get(jsonData.payload.instance_id);
                    if (msg != null) {
                        try {
                            await msg.edit({embeds: [jsonToEmbed(jsonData.payload)]});
                            log(`Alert ended (id = ${jsonData.payload.instance_id}): \n'${message.data}'`);

                            curAlerts.delete(jsonData.payload.instance_id);
                            // no longer tracking, no alerts left -> close connection
                            if (!isTracking && curAlerts.size == 0) {
                                setTimeout(closeConnection, 500);
                            }
                        } catch (error) { /* If message was deleted -> do nothing */ }
                    } else {
                        log(`Ignored: Alert ended (id = ${jsonData.payload.instance_id})`);
                    }
                }
                break;
            case "serviceStateChanged":
                // Connected
                break;
            case "heartbeat":
                // Check for unclosed events
                if (!isTracking && curAlerts.size != 0) {
                    let cutoff_time = structuredClone(END_DATE);
                    cutoff_time.setHours(END_DATE.getHours() + 1);
                    cutoff_time.setMinutes(END_DATE.getMinutes() + 35);
                    let now = getCurrentTimeAndRefreshConsts();
                    if (now >= cutoff_time) {
                        curAlerts.clear();
                        setTimeout(closeConnection, 500);
                        return;
                    }
                }
                break;
            default:
                log("Received: '" + message.data + "'");
        }
    };
}

function closeConnection(): void {
    log("Closing...");
    isTracking = false;
    ps2Socket.close();
    setTimeout(() => {
        if (ps2Socket.readyState != WebSocket.CLOSED) {
            ps2Socket.terminate(); // hard close
        }
    }, 5_000);
}

function jsonToEmbed(alert: AlertData): EmbedBuilder {
    let alertType;
    let event_id = alert.metagame_event_id;
    if (event_id == undefined) {
        alertType = {
            name: "Unknown Alert"
        };
    } else {
        alertType = alertTypes[event_id]; // read from json
    }

    let startTimeStamp;
    let endTimeStamp;
    if (alert.metagame_event_state_name == "started") {
        startTimeStamp = alert.timestamp;
        endTimeStamp = parseInt(alert.timestamp) + 5_400; // started -> add 1,5h
    } else {
        startTimeStamp = parseInt(alert.timestamp) - 5_400; // ended -> subtract 1,5h
        endTimeStamp = alert.timestamp;
    }

    let alertEmbed = new EmbedBuilder()
        .setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
        .setTitle(alertType.name)
        .addFields({name: "Timeframe", value: `<t:${startTimeStamp}:t> — <t:${endTimeStamp}:t>`});

    if (alert.metagame_event_state_name == "started") {
        // started -> use continent colors
        if (alert.zone_id in CONTINENTS) {
            alertEmbed.setColor(CONTINENTS[+alert.zone_id as keyof typeof CONTINENTS].color);
        }
    } else {
        // ended -> use winner faction's color
        let scores = [+alert.faction_vs, +alert.faction_nc, +alert.faction_tr];
        switch (indexOfMax(scores)) {
            case 0:
                alertEmbed.addFields({name: "Winner", value: `<:VS:793952227558424586> Vanu Sovereignty`});
                alertEmbed.setColor('#8A2BE2');
                break;
            case 1:
                alertEmbed.addFields({name: "Winner", value: `<:NC:793952194863956018> New Conglomerate`});
                alertEmbed.setColor('#4169E1');
                break;
            case 2:
                alertEmbed.addFields({name: "Winner", value: `<:TR:793952210752241665> Terran Republic`});
                alertEmbed.setColor('#FF0000');
                break;
        }
    }

    return alertEmbed;
}

function checkTime(): void {
    let now = getCurrentTimeAndRefreshConsts();

    log(`Checking at: ${dateToLocaleTimeString(now)} vs ${dateToLocaleTimeString(START_DATE)}-${dateToLocaleTimeString(END_DATE)}`);
    if (START_DATE <= now && now < END_DATE) { // start checking?
        bot.user?.setPresence(STATUSES.CHECKING); // Always set Status because it keeps resetting
        if (!isTracking) {
            connect();

            let difToEnd = END_DATE.getTime() - now.getTime();
            setTimeout(checkTime, difToEnd + 10_000); // wait until end of check-time to re-check
        } else { /* Do nothing */ }
    } else { // Outside of checking time
        bot.user?.setPresence(STATUSES.IDLE); // Always set Status because it keeps resetting

        if (isTracking) {
            // stop accepting new alerts
            isTracking = false;
        }

        if (ps2Socket != undefined && ps2Socket.readyState <= WebSocket.OPEN && curAlerts.size == 0) {
            // WebSocket still open and no running alerts left -> close connection
            closeConnection();
        }

        let difToStart = START_DATE.getTime() - now.getTime(); // difference now to start time
        if (difToStart < 0 || difToStart > 7_200_000) {
            // more than 2h until checking
            log("Wait 2h");
            setTimeout(checkTime, 7_200_000);
        } else {
            // less than 2h until checking
            log(`Wait ${Math.floor(difToStart / 60_000)}mins`);
            setTimeout(checkTime, difToStart + 10_000); // (dif < 2h) -> wait dif + small margin of error
        }
    }
}

function getCurrentTimeAndRefreshConsts(): Date {
    let now = new Date();
    // Set to same date to allow direct comparison
    START_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    END_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    return now;
}

// ========= Start Bot =========
bot.login(TOKEN).then(_ => {
    /* Ignore */
});
