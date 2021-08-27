const got = require('got');
const alertTypes = require('./alerts.json');

const { Client, Intents, MessageEmbed } = require('discord.js');
const myIntents = new Intents();
myIntents.add(Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS); // GUILD_MEMBERS, DIRECT_MESSAGES 
const bot = new Client({ intents: myIntents });

const TOKEN = process.env.TOKEN;

const statuses = {
    CHECKING: { status: 'online', activities: [{ name: 'Checking... 👀' }] },
    IDLE: { status: 'idle', activities: [{ name: 'Sleeping 💤' }] },
    ERROR: { status: 'dnd', activities: [{ name: 'Error: API unavailable' }] }
}

const popLevels = {
    1: "Dead",
    2: "Low",
    3: "Medium",
    4: "High",
    5: "Prime"
}

const continents = {
    2: "Indar",
    4: "Hossin",
    6: "Amerish",
    8: "Esamir",
}

let CHANNEL;
let lastAlert = 0;
let interval = null;
const uri = 'https://api.ps2alerts.com/instances/active?world=13'; // 13 = Cobalt
const startHours = 17; // 19 - 2 (to UTC)
const startMins = 0;
const endHours = 20; // 22 - 2 (to UTC)
const endMins = 30;

const alertInfo = async function() {
    let date = new Date();
    let hours = date.getUTCHours();
    let mins = date.getUTCMinutes();
    if (interval != null && (hours > endHours || (hours === endHours && mins >= endMins))) { // stop checking?
        stopChecking();
        checkTime();
        return;
    }

    let response = await got(uri, { retry: 0 }).json().catch(err => {
        console.error(`PS2-Alerts API unreachable. Error:\n${err}`);
        bot.user.setPresence(statuses.ERROR);
        stopChecking(true);
        setTimeout(checkTime, 900000); // check again in 15min
    });
    if (response == undefined) {
        return;
    }

    for (let alert of response) {
        if (lastAlert < alert.censusInstanceId) {

            if (typeof(alertTypes[alert.censusMetagameEventType]) === 'undefined') {
                console.log("Unable to find alert info for id " + alert.censusMetagameEventType);
                throw "Alert lookup error";
            }
            let now = Date.now();
            let start = Date.parse(alert.timeStarted);

            let timeLeft = (start + alert.duration) - now;
            let hoursLeft = Math.floor(timeLeft / 3600000);
            let minutesLeft = Math.floor(timeLeft / 60000) - hoursLeft * 60;
            /*
            let timeSinceStart = now - start;
            let hoursSinceStart = Math.floor(timeSinceStart / 3600000);
            let minutesSinceStart = Math.floor(timeSinceStart / 60000) - hoursSinceStart * 60;
            */
            date.setUTCHours(startHours, startMins, 0, 0);

            // Prevent duplicate Alerts if server restarts for some reason
            // Only post alerts older than 2mins at the beginning of tracking
            if (timeLeft > 5280000 || (now - date.getTime()) < 120000) {

                lastAlert = alert.censusInstanceId;
                let popLevel;
                if (alert.bracket >= 1 && alert.bracket <= 5) {
                    popLevel = popLevels[alert.bracket];
                } else {
                    popLevel = "Unknown";
                    console.log(`Error: Poplevel undefined for '${alert.bracket}'`);
                }

                let alertEmbed = new MessageEmbed()
                    .setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
                    .setTitle(alertTypes[alert.censusMetagameEventType].name)
                    .addField("Details:", `[${alertTypes[alert.censusMetagameEventType].description}](https://ps2alerts.com/alert/${alert.instanceId}?utm_source=auraxis-bot&utm_medium=discord&utm_campaign=partners)`)
                    //.addField("Time since start", hoursSinceStart + "h " + minutesSinceStart + "m", true)
                    .addField("Time left", `${hoursLeft}h ${minutesLeft}m`, true)
                    .addField("Activity Level", popLevel, true)
                    .addField('Territory Control', `\
                                \n<:VS:793952227558424586> **VS**: ${alert.result.vs}%\
                                \n<:NC:793952194863956018> **NC**: ${alert.result.nc}%\
                                \n<:TR:793952210752241665> **TR**: ${alert.result.tr}%`)
                    .setTimestamp()
                    .setFooter("Data from ps2alerts.com");

                switch (continents[alert.zone]) {
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

                console.log("New Alert, id:" + lastAlert);
                CHANNEL.send({ embeds: [alertEmbed] });
            }
        }
    }
}

bot.on('ready', () => {
    console.info(`Logged in as ${bot.user.tag}!`);
    /*
    bot.channels.fetch(process.env.CHANNEL)
        .then(channel => channel.send("Ready"));
    */

    bot.user.setPresence(statuses.IDLE);
    bot.channels.fetch(process.env.CHANNEL)
        .then(res => {
            CHANNEL = res;
            checkTime();
        })
        .catch(err => {
            throw `ERROR fetching Channel with id='${process.env.CHANNEL}'`;
        });
});

function startChecking(startOnly) {
    if (interval !== null) {
        throw "Double call to startChecking!";
    }
    if (startOnly !== true) {
        console.log("# Start tracking alerts. #");
        bot.user.setPresence(statuses.CHECKING);
    }
    alertInfo();
    interval = setInterval(alertInfo, 60000); // beginn checking alerts in 1min intervals
}

function stopChecking(stopOnly) {
    if (interval === null) {
        throw "Double call to stopChecking!";
    }
    if (stopOnly !== true) {
        console.log("# Stop tracking alerts.  #");
        bot.user.setPresence(statuses.IDLE);
    }
    clearInterval(interval); // stop checking alerts
    interval = null;
}

function checkTime() {
    let date = new Date();
    let hours = date.getUTCHours();
    let mins = date.getUTCMinutes();

    console.log(`Checking at: ${hours}:${mins} vs ${startHours}:${startMins}`);
    if ((hours > startHours || (hours === startHours && mins >= startMins)) && // start checking ?
        (hours < endHours || (hours === endHours && mins < endMins))) { // now >= start && now < end

        startChecking();
    } else {
        let dif = ((startHours * 60 + startMins) * 60000) - ((date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()) * 1000); // difference now to start time
        if (dif < 0 || dif > 1800000) {
            console.log("Wait 30mins");
            setTimeout(checkTime, 1800000);
        } else {
            console.log(`Wait ${Math.floor(dif / 60000)}mins`);
            setTimeout(checkTime, dif + 30000); // (dif < 30min) -> wait dif
        }
    }
}

/*
bot.on('messageCreate', msg => {
    let str = msg.content.toLocaleLowerCase();
    if (str.startsWith('!test')) {

    }
});
*/

bot.login(TOKEN);