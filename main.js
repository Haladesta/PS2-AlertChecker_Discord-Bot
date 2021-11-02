'use strict';
const got = require('got');
var http = require('http');
const alertTypes = require('./alerts.json');
const WebSocket = require('ws');

const { Client, Intents, MessageEmbed } = require('discord.js');
const myIntents = new Intents();
myIntents.add(Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS); // GUILD_MEMBERS, DIRECT_MESSAGES
const bot = new Client({ intents: myIntents });
const TOKEN = process.env.TOKEN;

const STATUSES = {
    CHECKING: { status: 'online', activities: [{ name: 'Checking... 👀' }] },
    IDLE: { status: 'idle', activities: [{ name: 'Sleeping 💤' }] },
    ERROR: { status: 'dnd', activities: [{ name: 'Error: API unavailable' }] }
}

const CONTINENTS = {
    2: "Indar",
    4: "Hossin",
    6: "Amerish",
    8: "Esamir",
}

let CHANNEL;
const uri = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${process.env.SERVICE_ID}`;
var ps2Socket;

const startHours = 17; // (to UTC)
const startMins = 0;
const endHours = 21; // (to UTC)
const endMins = 30;

bot.on('ready', async() => {


    console.info(`Logged in as ${bot.user.tag}!`);
    bot.user.setPresence(STATUSES.IDLE);
    CHANNEL = await bot.channels.fetch(process.env.CHANNEL);

    checkTime();
});

const connect = function() {
    if (ps2Socket != null) {
        console.error("Warning: Tried opening non-closed connection!");
        return;
    }

    ps2Socket = new WebSocket(uri);

    ps2Socket.onopen = event => {
        console.log('Client Connected');

        var subscribeObj = {
            "service": "event",
            "action": "subscribe",
            "worlds": ["13"], // 13 = Cobalt, others: "10", "40", "17", "1"
            "eventNames": ["MetagameEvent"]
        }

        ps2Socket.send(JSON.stringify(subscribeObj));
    };

    ps2Socket.onclose = event => {
        console.log('Connection Closed');
    };

    ps2Socket.onerror = event => {
        onsole.log("Connection Error: " + event);
    };

    ps2Socket.onmessage = event => {
        let jsonData = JSON.parse(event.data);
        switch (jsonData.type) {
            case "serviceMessage":
                // Post Alert
                postAlert(jsonData.payload);
                console.log("New Alert: '" + event.data + "'");
                break;
            case "serviceStateChanged":
                // Connected
                break;
            case "heartbeat":
                // Ignore
                break;
            default:
                console.log("Received: '" + event.data + "'");
        }
    };
}

const closeConnection = function() {
    if (ps2Socket == null) {
        console.error("Warning: Tried closing already closed connection!");
        return;
    }

    ps2Socket.close();
    ps2Socket = null;
}

const postAlert = async function(alert) {
    let alertType = alertTypes[alert.metagame_event_id];
    let scores = [Math.round(alert.faction_vs), Math.round(alert.faction_nc), Math.round(alert.faction_tr)];
    /*
    let leader = indexOfMax(scores);
    for (var i = 0; i < scores.length; i++)
    {
    	let val = scores[i];
    	val = Math.round(val);
    	if (i === leader)
    		scores[i] = `${val}% :crown:`; // underline current leader
    	else
    		scores[i] = `${val}%`;
    }
    */
    let alertEmbed = new MessageEmbed()
        .setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
        .setTitle(alertType.name)
        .addField("Details:", `[${alertType.description}](https://ps2alerts.com/alert/${alert.world_id}-${alert.instance_id})`)
        //.addField("Time since start", hoursSinceStart + "h " + minutesSinceStart + "m", true)
        .addField("Timeframe", `<t:${alert.timestamp}:t> — <t:${parseInt(alert.timestamp) + 5400}:t>`)
        //.addField("Activity Level", popLevel, true)
        .addField('Territory Control', `\
                                \n<:VS:793952227558424586> **VS**: ${scores[0]}\
                                \n<:NC:793952194863956018> **NC**: ${scores[1]}\
                                \n<:TR:793952210752241665> **TR**: ${scores[2]}`)
        .setTimestamp();

    switch (CONTINENTS[alert.zone_id]) {
        case 'Amerish':
            alertEmbed.setColor('#59e632');
            break;
        case 'Esamir':
            alertEmbed.setColor('#cbd5e1');
            break;
        case 'Indar':
            alertEmbed.setColor('#fcda2b');
            break;
        case 'Hossin':
            alertEmbed.setColor('#b4de2a');
            break;
    }

    console.log(`New Alert, id = ${alert.instance_id}`);
    CHANNEL.send({ embeds: [alertEmbed] });
}

function checkTime() {
    let curDate = new Date();
    let curHours = curDate.getUTCHours();
    let curMins = curDate.getUTCMinutes();
    let curSecs = curDate.getUTCSeconds();

    console.log(`Checking at: ${curHours}:${curMins} vs ${startHours}:${startMins}`);
    if ((curHours > startHours || (curHours === startHours && curMins >= startMins)) && // start checking ?
        (curHours < endHours || (curHours === endHours && curMins < endMins))) { // now >= start && now < end

        bot.user.setPresence(STATUSES.CHECKING);
        connect();
        let difToEnd = ((endHours * 60 + endMins) * 60000) - ((curHours * 3600 + curMins * 60 + curSecs) * 1000); // difference now to start time
        setTimeout(checkTime, difToEnd + 10000); // wait until end of check-time to re-check
    } else {
        if (ps2Socket != null) {
            bot.user.setPresence(STATUSES.IDLE);
            closeConnection();
        }

        let difToStart = ((startHours * 60 + startMins) * 60000) - ((curHours * 3600 + curMins * 60 + curSecs) * 1000); // difference now to start time
        if (difToStart < 0 || difToStart > 432000000) {
            console.log("Wait 2h");
            setTimeout(checkTime, 432000000);
        } else {
            console.log(`Wait ${Math.floor(difToStart / 60000)}mins`);
            setTimeout(checkTime, difToStart + 10000); // (dif < 2h) -> wait dif + small margin of error
        }
    }
}

bot.login(TOKEN);

if (process.env.PORT != null) {
    http.createServer(function(request, response) {
        response.writeHead(200);
        response.end();
    }).listen(process.env.PORT);
}

function indexOfMax(arr) {
    if (arr.length === 0) {
        return -1;
    }

    var max = arr[0];
    var maxIndex = 0;

    for (var i = 1; i < arr.length; i++) {
        if (arr[i] > max) {
            maxIndex = i;
            max = arr[i];
        }
    }

    return maxIndex;
}