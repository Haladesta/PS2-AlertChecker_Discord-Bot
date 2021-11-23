'use strict';
require('dotenv').config();
//import got from 'got';
import alertTypes from './alerts.json';
import WebSocket from 'ws';

log("-------------------------------------");
const PORT: string = process.env.PORT || "5000";
import http from 'http';
http.createServer((request: any, response: any) =>
{
	response.writeHead(200);
	response.end();
}).listen(PORT);
log(`Listening on Port ${PORT}`);
log("-------------------------------------");

import { Channel, Client, Intents, Message, MessageEmbed, PresenceData, TextChannel } from 'discord.js';
const myIntents: Intents = new Intents();
myIntents.add(Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS); // GUILD_MEMBERS, DIRECT_MESSAGES
const bot: Client = new Client({ intents: myIntents });
const TOKEN: string = process.env.TOKEN || "";

const STATUSES: Record<string, PresenceData> = {
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
};

let CHANNEL: TextChannel;
const uri: string = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${process.env.SERVICE_ID}`;
var ps2Socket: WebSocket;

interface AlertData
{
	event_name: string,
	experience_bonus: string,
	faction_nc: string,
	faction_tr: string,
	faction_vs: string,
	instance_id: string,
	metagame_event_id: keyof typeof alertTypes,
	metagame_event_state: string,
	metagame_event_state_name: "ended" | "started",
	timestamp: string,
	world_id: string,
	zone_id: keyof typeof CONTINENTS
}
interface PS2EventMessage
{
	payload: AlertData,
	service: string,
	type: string
}

// default 18:00 - 21:30
const startHours: number = 17; // 17 (to UTC)
const startMins: number = 30;
const endHours: number = 20; // 20 (to UTC)
const endMins: number = 30;
let isTracking = false;

const curAlerts: Map<String, Message<boolean>> = new Map();

bot.on('ready', async () =>
{
	log(`Logged in as ${bot.user?.tag}!`);
	bot.user?.setPresence(STATUSES.IDLE);
	let channelid: string = process.env.CHANNEL || "";
	CHANNEL = await bot.channels.fetch(channelid) as TextChannel;

	checkTime();
});
bot.on('error', (err) =>
{
	log(err.message);
})

const connect = () =>
{
	if (ps2Socket?.OPEN)
	{
		log("Warning: Tried opening non-closed connection!");
		return;
	}

	ps2Socket = new WebSocket(uri);

	ps2Socket.onopen = (event) =>
	{
		log('Client Connected');

		var subscribeObj = {
			"service": "event",
			"action": "subscribe",
			"worlds": ["13"], // 13 = Cobalt, others: "10", "40", "17", "1"
			"eventNames": ["MetagameEvent"]
		};

		ps2Socket.send(JSON.stringify(subscribeObj));
	};

	ps2Socket.onclose = event =>
	{
		log('Connection Closed');
	};

	ps2Socket.onerror = event =>
	{
		log("Connection Error: " + event);
	};

	ps2Socket.onmessage = async (event) =>
	{
		let jsonData = JSON.parse(event.data.toString());
		switch (jsonData.type)
		{
			case "serviceMessage":
				// Post Alert
				if (jsonData.payload.metagame_event_state_name == "started" && isTracking)
				{
					var msg = await CHANNEL.send({ embeds: [jsonToEmbed(jsonData.payload)] });
					curAlerts.set(jsonData.payload.instance_id, msg);
					log(`New Alert (id = ${jsonData.payload.instance_id}): \n'${event.data}'`);
				}
				else if (jsonData.payload.metagame_event_state_name == "ended")
				{
					let msg = curAlerts.get(jsonData.payload.instance_id);
					if (msg != null)
					{
						try
						{
							msg.edit({ embeds: [jsonToEmbed(jsonData.payload)] });
							log(`Alert ended (id = ${jsonData.payload.instance_id}): \n'${event.data}'`);

							curAlerts.delete(jsonData.payload.instance_id);
							if (isTracking == false && curAlerts.size == 0)
							{
								closeConnection();
							}
						}
						catch (error) { /* If message was deleted -> do nothing */ }
					}
					else
					{
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
	};
};

const closeConnection = function ()
{
	if (ps2Socket.CLOSED)
	{
		log("Warning: Tried closing already closed connection!");
		return;
	}

	ps2Socket.close();
	setTimeout(() =>
	{
		if (!ps2Socket.CLOSED) // hard close
		{
			ps2Socket.terminate();
		}
	}, 10000);
};

function jsonToEmbed(alert: AlertData)
{
	let alertType = alertTypes[alert.metagame_event_id]; // read from json
	let alertEmbed = new MessageEmbed()
		.setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
		.setTitle(alertType.name)
		//.addField("Details:", `[${alertType.description}](https://ps2alerts.com/alert/${alert.world_id}-${alert.instance_id})`)
		.addField("Timeframe", `<t:${alert.timestamp}:t> — <t:${parseInt(alert.timestamp) + (alert.metagame_event_state_name == "ended" ? -5400 : 5400)}:t>`)
		//.addField("Activity Level", popLevel, true)
		//.addField('Territory Control',
		//	 `<:VS:793952227558424586> **VS**: ${scores[0]}%\
		//	\n<:NC:793952194863956018> **NC**: ${scores[1]}%\
		//	\n<:TR:793952210752241665> **TR**: ${scores[2]}%`)
		//.setTimestamp()
		;

	if (alert.metagame_event_state_name == "started")
	{
		switch (CONTINENTS[alert.zone_id])
		{
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
		};
	}
	else if (alert.metagame_event_state_name == "ended")
	{
		let scores = [+alert.faction_vs, +alert.faction_nc, +alert.faction_tr];
		switch (indexOfMax(scores))
		{
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
		};
	}

	return alertEmbed;
}

function checkTime()
{
	let curDate = new Date();
	let curHours = curDate.getUTCHours();
	let curMins = curDate.getUTCMinutes();
	let curSecs = curDate.getUTCSeconds();

	log(`Checking at: ${leadZero(curHours)}:${leadZero(curMins)} vs ${leadZero(startHours)}:${leadZero(startMins)}-${leadZero(endHours)}:${leadZero(endMins)}`);
	if ((curHours > startHours || (curHours === startHours && curMins >= startMins)) && // start checking ?
		(curHours < endHours || (curHours === endHours && curMins < endMins))) // now >= start && now < end
	{
		if (!isTracking)
		{
			bot.user?.setPresence(STATUSES.CHECKING);
			isTracking = true;
			connect();

			let difToEnd = ((endHours * 60 + endMins) * 60000) - ((curHours * 3600 + curMins * 60 + curSecs) * 1000); // difference now to start time
			setTimeout(checkTime, difToEnd + 10000); // wait until end of check-time to re-check
		}
	}
	else
	{
		if (isTracking)
		{
			bot.user?.setPresence(STATUSES.IDLE);
			isTracking = false;
		}
		if (ps2Socket?.OPEN && curAlerts.size == 0)
		{
			closeConnection();
		}

		let difToStart = ((startHours * 60 + startMins) * 60000) - ((curHours * 3600 + curMins * 60 + curSecs) * 1000); // difference now to start time
		if (difToStart < 0 || difToStart > 7200000)
		{
			log("Wait 2h");
			setTimeout(checkTime, 7200000);
		}
		else
		{
			log(`Wait ${Math.floor(difToStart / 60000)}mins`);
			setTimeout(checkTime, difToStart + 10000); // (dif < 2h) -> wait dif + small margin of error
		}
	}
}

bot.login(TOKEN);

// HELPERS
function log(msg: string)
{
	let date = new Date();
	console.log(`[${date.toLocaleDateString('de-DE')}-${date.toLocaleTimeString('de-DE')}] | ${msg}`);
}

function indexOfMax(arr: Array<Number>)
{
	if (arr.length === 0)
	{
		return -1;
	}

	var max = arr[0];
	var maxIndex = 0;

	for (var i = 1; i < arr.length; i++)
	{
		if (arr[i] > max)
		{
			maxIndex = i;
			max = arr[i];
		}
	}

	return maxIndex;
}

function leadZero(num: Number)
{
	if (num < 10)
		return `0${num}`;
	else
		return `${num}`;
}
