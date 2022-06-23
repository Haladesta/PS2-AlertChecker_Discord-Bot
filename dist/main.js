'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
//import got from 'got';
const alerts_json_1 = __importDefault(require("./alerts.json"));
const ws_1 = require("ws");
const discord_js_1 = require("discord.js");
const myIntents = new discord_js_1.Intents();
myIntents.add(discord_js_1.Intents.FLAGS.GUILD_MESSAGES, discord_js_1.Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS, discord_js_1.Intents.FLAGS.GUILD_MEMBERS); // DIRECT_MESSAGES
const bot = new discord_js_1.Client({ intents: myIntents });
const TOKEN = process.env.TOKEN || "";
const STATUSES = {
    CHECKING: {
        status: 'online', activities: [{ name: 'Checking... 👀' }]
    },
    IDLE: {
        status: 'idle', activities: [{ name: 'Sleeping 💤' }]
    },
    ERROR: {
        status: 'dnd', activities: [{ name: 'Error: API unavailable' }]
    }
};
const CONTINENTS = {
    2: "Indar",
    4: "Hossin",
    6: "Amerish",
    8: "Esamir",
    14: "Koltyr",
    344: "Oshur"
};
const CONTINENT_COLORS = {
    2: '#fcda2b',
    4: '#b4de2a',
    6: '#59e632',
    8: '#cbd5e1',
    14: '#454545',
    344: '#168cfa'
};
let CHANNEL;
let DEBUG_CHANNEL;
const URI = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${process.env.SERVICE_ID}`;
let ps2Socket;
// time in UTC
const START_DATE = new Date();
START_DATE.setHours(17, 30, 0, 0);
const END_DATE = new Date();
END_DATE.setHours(22, 0, 0, 0);
let isTracking = false;
const curAlerts = new Map();
bot.on('ready', () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    CHANNEL = (yield bot.channels.fetch(process.env.CHANNEL || ""));
    DEBUG_CHANNEL = (yield bot.channels.fetch(process.env.DEBUG_CHANNEL || ""));
    log(`Logged in as ${(_a = bot.user) === null || _a === void 0 ? void 0 : _a.tag}!`);
    (_b = bot.user) === null || _b === void 0 ? void 0 : _b.setPresence(STATUSES.IDLE);
    checkTime();
}));
bot.on('error', err => {
    log(err.message);
});
function connect() {
    if ((ps2Socket === null || ps2Socket === void 0 ? void 0 : ps2Socket.readyState) == ws_1.WebSocket.OPEN) {
        log("Warning: Tried opening non-closed connection!", log_level.warn);
        return;
    }
    let conf = process.env.REJECT_UNAUTHORIZED;
    let rejectUnauthorized = true;
    if (conf == "false") {
        rejectUnauthorized = false;
    }
    ps2Socket = new ws_1.WebSocket(URI, { "rejectUnauthorized": rejectUnauthorized });
    ps2Socket.onopen = (event) => {
        log('Client Connected');
        let subscribeObj = {
            "service": "event",
            "action": "subscribe",
            "worlds": ["13"],
            "eventNames": ["MetagameEvent"]
        };
        ps2Socket.send(JSON.stringify(subscribeObj));
    };
    ps2Socket.onclose = event => {
        log('Connection Closed');
    };
    ps2Socket.onerror = event => {
        var _a;
        (_a = bot.user) === null || _a === void 0 ? void 0 : _a.setPresence(STATUSES.ERROR);
        log("Connection Error: \n" + event.error.message + "\n" + event.error.stack);
        setTimeout(checkTime, 600000);
    };
    ps2Socket.onmessage = (event) => __awaiter(this, void 0, void 0, function* () {
        let jsonData = JSON.parse(event.data.toString());
        switch (jsonData.type) {
            case "serviceMessage":
                // Post Alert
                if (jsonData.payload.metagame_event_state_name == "started") {
                    if (isTracking) {
                        try {
                            let msg = yield CHANNEL.send({ embeds: [jsonToEmbed(jsonData.payload)] });
                            curAlerts.set(jsonData.payload.instance_id, msg);
                            log(`New Alert (id = ${jsonData.payload.instance_id}): \n'${event.data}'`);
                        }
                        catch (error) {
                            if (typeof error === "string") {
                                yield DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\``);
                            }
                            else if (error instanceof Error) {
                                yield DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\`\n\`${error.stack}\``);
                            }
                            console.error("Unexpected Error parsing alert-data:");
                            console.error(jsonData);
                            throw error;
                        }
                    }
                }
                else if (jsonData.payload.metagame_event_state_name == "ended") {
                    let msg = curAlerts.get(jsonData.payload.instance_id);
                    if (msg != null) {
                        try {
                            msg.edit({ embeds: [jsonToEmbed(jsonData.payload)] });
                            log(`Alert ended (id = ${jsonData.payload.instance_id}): \n'${event.data}'`);
                            curAlerts.delete(jsonData.payload.instance_id);
                            if (isTracking == false && curAlerts.size == 0) {
                                setTimeout(closeConnection, 1000);
                            }
                        }
                        catch (error) { /* If message was deleted -> do nothing */ }
                    }
                    else {
                        log(`Ignored: Alert ended (id = ${jsonData.payload.instance_id})`);
                    }
                }
                break;
            case "serviceStateChanged":
                // Connected
                break;
            case "heartbeat":
                // Ignore
                break;
            default:
                log("Received: '" + event.data + "'");
        }
    });
}
;
function closeConnection() {
    if (ps2Socket == undefined || ps2Socket.readyState == ws_1.WebSocket.CLOSED) {
        log("Warning: Tried closing already closed connection!", log_level.warn);
        return;
    }
    log("Closing...");
    ps2Socket.close();
    setTimeout(() => {
        if (ps2Socket.readyState != ws_1.WebSocket.CLOSED) // hard close
         {
            ps2Socket.terminate();
        }
    }, 10000);
}
;
function jsonToEmbed(alert) {
    let alertType = alerts_json_1.default[alert.metagame_event_id]; // read from json
    let startTimeStamp;
    let endTimeStamp;
    if (alert.metagame_event_state_name == "started") {
        startTimeStamp = alert.timestamp;
        endTimeStamp = parseInt(alert.timestamp) + 5400;
    }
    else {
        startTimeStamp = parseInt(alert.timestamp) - 5400;
        endTimeStamp = alert.timestamp;
    }
    let alertEmbed = new discord_js_1.MessageEmbed()
        .setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
        .setTitle(alertType.name)
        //.addField("Details:", `[${alertType.description}](https://ps2alerts.com/alert/${alert.world_id}-${alert.instance_id})`)
        .addField("Timeframe", `<t:${startTimeStamp}:t> — <t:${endTimeStamp}:t>`);
    if (alert.metagame_event_state_name == "started") {
        alertEmbed.setColor(CONTINENT_COLORS[alert.zone_id]);
    }
    else {
        let scores = [+alert.faction_vs, +alert.faction_nc, +alert.faction_tr];
        switch (indexOfMax(scores)) {
            case 0:
                alertEmbed.addField("Winner", `<:VS:793952227558424586> Vanu Sovereignty`);
                alertEmbed.setColor('#8A2BE2');
                break;
            case 1:
                alertEmbed.addField("Winner", `<:NC:793952194863956018> New Conglomerate`);
                alertEmbed.setColor('#4169E1');
                break;
            case 2:
                alertEmbed.addField("Winner", `<:TR:793952210752241665> Terran Republic`);
                alertEmbed.setColor('#FF0000');
                break;
        }
        ;
    }
    return alertEmbed;
}
function checkTime() {
    var _a, _b;
    let now = new Date();
    START_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    END_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    log(`Checking at: ${dateToLocaleTimeString(now)} vs ${dateToLocaleTimeString(START_DATE)}-${dateToLocaleTimeString(END_DATE)}`);
    if (START_DATE <= now && now < END_DATE) // start checking ?
     {
        if (!isTracking) {
            (_a = bot.user) === null || _a === void 0 ? void 0 : _a.setPresence(STATUSES.CHECKING);
            isTracking = true;
            connect();
            let difToEnd = END_DATE.getTime() - now.getTime();
            setTimeout(checkTime, difToEnd + 10000); // wait until end of check-time to re-check
        }
        else { /* Do nothing */ }
    }
    else {
        if (isTracking) {
            (_b = bot.user) === null || _b === void 0 ? void 0 : _b.setPresence(STATUSES.IDLE);
            isTracking = false;
        }
        if (ps2Socket != undefined && ps2Socket.readyState == ws_1.WebSocket.OPEN && curAlerts.size == 0) {
            closeConnection();
        }
        let difToStart = START_DATE.getTime() - now.getTime(); // difference now to start time
        if (difToStart < 0 || difToStart > 7200000) {
            log("Wait 2h");
            setTimeout(checkTime, 7200000);
        }
        else {
            log(`Wait ${Math.floor(difToStart / 60000)}mins`);
            setTimeout(checkTime, difToStart + 10000); // (dif < 2h) -> wait dif + small margin of error
        }
    }
}
bot.login(TOKEN);
// HELPERS
function dateToLocaleTimeString(date) {
    return date.toLocaleTimeString("de-DE", { "hour12": false, "hour": "2-digit", "minute": "2-digit" });
}
function dateToLocaleString(date) {
    return date.toLocaleString("de-DE", { "month": "2-digit", "day": "2-digit", "hour12": false, "hour": "2-digit", "minute": "2-digit" });
}
var log_level;
(function (log_level) {
    log_level[log_level["info"] = 0] = "info";
    log_level[log_level["warn"] = 1] = "warn";
    log_level[log_level["error"] = 2] = "error";
})(log_level || (log_level = {}));
function log(msg, level = log_level.info) {
    var timestamp = dateToLocaleString(new Date());
    switch (level) {
        case log_level.info:
            console.log(`[${timestamp}] | ${msg}`);
            break;
        case log_level.warn:
            console.warn(`[${timestamp}] | ${msg}`);
            break;
        case log_level.error:
            console.error(`[${timestamp}] | ${msg}`);
            break;
    }
}
function indexOfMax(arr) {
    if (arr.length === 0) {
        return -1;
    }
    let max = arr[0];
    let maxIndex = 0;
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > max) {
            maxIndex = i;
            max = arr[i];
        }
    }
    return maxIndex;
}
function leadZero(num) {
    if (num < 10)
        return `0${num}`;
    else
        return `${num}`;
}
