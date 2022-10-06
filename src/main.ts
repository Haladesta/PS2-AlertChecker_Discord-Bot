'use strict';
require('dotenv').config();
//import got from 'got';
import alertTypes from './alerts.json';
import { WebSocket, ClientOptions } from 'ws';

import { Channel, Client, IntentsBitField, Message, EmbedBuilder, PresenceData, TextChannel, ColorResolvable, HexColorString } from 'discord.js';
import { type } from 'os';
const myIntents = new IntentsBitField();
myIntents.add(IntentsBitField.Flags.GuildMessages, IntentsBitField.Flags.GuildEmojisAndStickers, IntentsBitField.Flags.GuildMembers); // DIRECT_MESSAGES
const bot: Client = new Client({ intents: myIntents });
const TOKEN: string = process.env.TOKEN || "";
if (TOKEN == "") {
	throw new Error("Error: TOKEN in env is invalid or missing.");
}

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
	14: "Koltyr",
	344: "Oshur"
};

const CONTINENT_COLORS = {
	2: '#fcda2b' as HexColorString,
	4: '#b4de2a' as HexColorString,
	6: '#59e632' as HexColorString,
	8: '#cbd5e1' as HexColorString,
	14: '#454545' as HexColorString,
	344: '#168cfa' as HexColorString
}

let CHANNEL: TextChannel;
let DEBUG_CHANNEL: TextChannel;
const URI: string = process.env.SOCKET_URL || "";
if (URI == "") {
	throw new Error("Error: SOCKET_URL in env is invalid or missing.");
}
let ps2Socket: WebSocket;

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
	zone_id: string
}
interface PS2EventMessage
{
	payload: AlertData,
	service: string,
	type: string
}

// time in UTC
const START_DATE = new Date();
START_DATE.setHours(17, 30, 0, 0);
const END_DATE = new Date();
END_DATE.setHours(22, 0, 0, 0);
let isTracking = false;

const curAlerts: Map<string, Message<boolean>> = new Map();

bot.on('ready', async () =>
{
	CHANNEL = await bot.channels.fetch(process.env.CHANNEL || "") as TextChannel;
	DEBUG_CHANNEL = await bot.channels.fetch(process.env.DEBUG_CHANNEL || "") as TextChannel;

	log(`Logged in as ${bot.user?.tag}!`);
	bot.user?.setPresence(STATUSES.IDLE);

	checkTime();
});
bot.on('error', err =>
{
	log(err.message);
});

function connect(): void
{
	// if (ps2Socket?.readyState == WebSocket.OPEN)
	// {
	// 	log("Warning: Tried opening non-closed connection!", log_level.warn);
	// 	return;
	// }

	let conf = process.env.REJECT_UNAUTHORIZED
	let rejectUnauthorized = true
	if (conf == "false")
	{
		rejectUnauthorized = false
	}
	ps2Socket = new WebSocket(URI, { "rejectUnauthorized": rejectUnauthorized });

	ps2Socket.onopen = (event) =>
	{
		log('Client Connected');
		bot.user?.setPresence(STATUSES.CHECKING);
		isTracking = true

		let subscribeObj = {
			"service": "event",
			"action": "subscribe",
			"worlds": ["13"], // 13 = Cobalt, others: "10", "40", "17", "1"
			"eventNames": ["MetagameEvent"]
		};

		ps2Socket.send(JSON.stringify(subscribeObj));
	};

	ps2Socket.onclose = event =>
	{
		isTracking = false
		log('Connection Closed');
	};

	ps2Socket.onerror = event =>
	{
		isTracking = false
		bot.user?.setPresence(STATUSES.ERROR);
		log("Connection Error: \n" + event.error.message + "\n" + event.error.stack, log_level.error);
		setTimeout(checkTime, 600_000);
	};

	ps2Socket.onmessage = async (message) =>
	{
		let jsonData = JSON.parse(message.data.toString());
		
		switch (jsonData.type)
		{
			case "serviceMessage":
				// Post Alert
				if (jsonData.payload.metagame_event_state_name == "started")
				{
					if (isTracking)
					{
						try
						{
							let msg = await CHANNEL.send({ embeds: [jsonToEmbed(jsonData.payload)] });
							curAlerts.set(jsonData.payload.instance_id, msg);
							log(`New Alert (id = ${jsonData.payload.instance_id}): \n'${message.data}'`);
						}
						catch (error)
						{
							if (typeof error === "string")
							{
								await DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\``);
							} else if (error instanceof Error)
							{
								await DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\`\n\`${error.stack}\``);
							}
							console.error("Unexpected Error parsing alert-data:");
							console.error(jsonData);
							throw error;
						}
					}
				}
				else if (jsonData.payload.metagame_event_state_name == "ended")
				{
					let msg = curAlerts.get(jsonData.payload.instance_id);
					if (msg != null)
					{
						try
						{
							msg.edit({ embeds: [jsonToEmbed(jsonData.payload)] });
							log(`Alert ended (id = ${jsonData.payload.instance_id}): \n'${message.data}'`);

							curAlerts.delete(jsonData.payload.instance_id);
							if (isTracking == false && curAlerts.size == 0)
							{
								setTimeout(closeConnection, 500);
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
				log("Received: '" + message.data + "'");
		}
	};
};

function closeConnection(): void
{
	// if (ps2Socket == undefined || ps2Socket.readyState == WebSocket.CLOSED)
	// {
	// 	log("Warning: Tried closing already closed connection!", log_level.warn);
	// 	return;
	// }

	log("Closing...")
	isTracking = false
	ps2Socket.close();
	setTimeout(() =>
	{
		if (ps2Socket.readyState != WebSocket.CLOSED) // hard close
		{
			ps2Socket.terminate();
		}
	}, 5_000);
};

function jsonToEmbed(alert: AlertData): EmbedBuilder
{
	let alertType = alertTypes[alert.metagame_event_id]; // read from json
	
	let startTimeStamp;
	let endTimeStamp;
	if (alert.metagame_event_state_name == "started")
	{
		startTimeStamp = alert.timestamp;
		endTimeStamp = parseInt(alert.timestamp) + 5_400;
	}
	else
	{
		startTimeStamp = parseInt(alert.timestamp) - 5_400;
		endTimeStamp = alert.timestamp;
	}

	let alertEmbed = new EmbedBuilder()
		.setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
		.setTitle(alertType.name)
		.addFields({name: "Timeframe", value: `<t:${startTimeStamp}:t> — <t:${endTimeStamp}:t>`});

	if (alert.metagame_event_state_name == "started")
	{
		if (alert.zone_id in CONTINENTS) {
			alertEmbed.setColor(CONTINENT_COLORS[+alert.zone_id as keyof typeof CONTINENTS]);
		}
	}
	else
	{
		let scores = [+alert.faction_vs, +alert.faction_nc, +alert.faction_tr];
		switch (indexOfMax(scores))
		{
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
		};
	}

	return alertEmbed;
}

function checkTime(): void
{
	let now = new Date();
	START_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
	END_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());

	log(`Checking at: ${dateToLocaleTimeString(now)} vs ${dateToLocaleTimeString(START_DATE)}-${dateToLocaleTimeString(END_DATE)}`);
	if (START_DATE <= now && now < END_DATE) // start checking ?
	{
		if (!isTracking)
		{
			connect();

			let difToEnd = END_DATE.getTime() - now.getTime();
			setTimeout(checkTime, difToEnd + 10_000); // wait until end of check-time to re-check
		}
		else { /* Do nothing */ }
	}
	else
	{
		if (isTracking)
		{
			bot.user?.setPresence(STATUSES.IDLE);
			isTracking = false;
		}

		if (ps2Socket != undefined && ps2Socket.readyState <= WebSocket.OPEN && curAlerts.size == 0)
		{
			closeConnection();
		}

		let difToStart = START_DATE.getTime() - now.getTime(); // difference now to start time
		if (difToStart < 0 || difToStart > 7_200_000)
		{ // more than 2h until checking
			log("Wait 2h");
			setTimeout(checkTime, 7_200_000);
		}
		else
		{ // less than 2h until checking
			log(`Wait ${Math.floor(difToStart / 60_000)}mins`);
			setTimeout(checkTime, difToStart + 10_000); // (dif < 2h) -> wait dif + small margin of error
		}
	}
}


bot.login(TOKEN);

// HELPERS
function dateToLocaleTimeString(date: Date)
{
	return date.toLocaleTimeString("de-DE", { "hour12": false, "hour": "2-digit", "minute": "2-digit" })
}
function dateToLocaleString(date: Date)
{
	return date.toLocaleString("de-DE", { "month": "2-digit", "day": "2-digit", "hour12": false, "hour": "2-digit", "minute": "2-digit" })
}

enum log_level
{
	info = 0,
	warn = 1,
	error = 2
}
function log(msg: string, level: log_level = log_level.info): void
{
	var timestamp = dateToLocaleString(new Date())
	switch (level)
	{
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

function indexOfMax(arr: Array<number>): number
{
	if (arr.length === 0)
	{
		return -1;
	}

	let max = arr[0];
	let maxIndex = 0;

	for (let i = 1; i < arr.length; i++)
	{
		if (arr[i] > max)
		{
			maxIndex = i;
			max = arr[i];
		}
	}

	return maxIndex;
}

function leadZero(num: number): string
{
	if (num < 10)
		return `0${num}`;
	else
		return `${num}`;
}
