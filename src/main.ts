'use strict';
require('dotenv').config();
//import got from 'got';
import alertTypes from './alerts.json';
import WebSocket from 'ws';

import { Channel, Client, Intents, Message, MessageEmbed, PresenceData, TextChannel, ColorResolvable, HexColorString } from 'discord.js';
const myIntents: Intents = new Intents();
myIntents.add(Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS, Intents.FLAGS.GUILD_MEMBERS); // DIRECT_MESSAGES
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

const CHANNEL = await bot.channels.fetch(process.env.CHANNEL || "") as TextChannel;
const DEBUG_CHANNEL = await bot.channels.fetch(process.env.DEBUG_CHANNEL || "") as TextChannel;
const URI: string = `wss://push.planetside2.com/streaming?environment=ps2&service-id=s:${process.env.SERVICE_ID}`;
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
	zone_id: keyof typeof CONTINENTS
}
interface PS2EventMessage
{
	payload: AlertData,
	service: string,
	type: string
}

// time in UTC
const START_DATE = new Date();
START_DATE.setHours(16, 30, 0, 0);
const END_DATE = new Date();
END_DATE.setHours(20, 30, 0, 0);
let isTracking = false;

const curAlerts: Map<string, Message<boolean>> = new Map();

bot.on('ready', async () =>
{
	log(`Logged in as ${bot.user?.tag}!`);
	bot.user?.setPresence(STATUSES.IDLE);

	checkTime();
});
bot.on('error', err =>
{
	log(err.message);
});
bot.on('messageCreate', msg =>
{
	let pro_users = ["530104861824647180", "160100096799801344"]
	if (pro_users.includes(msg.author.id) && msg.content.toLowerCase().includes("penislantis"))
	{
		let ping_user_id = process.env.PING_USER || ""
		msg.reply(
			'Eyo, Atlantis? More like **Penislantis**, am I right?! <:HAHAHAHA:711999347474300939> <:HAHAHAHA:711999347474300939>\n'
			+ ' :middle_finger:⠀⠀⠀⠀:smile:\n\n'
			+ '⠀⠀:bug::zzz: :shirt: :bug:\n\n'
			+ '⠀⠀⠀⠀⠀⠀:fuelpump: :boot:\n\n'
			+ '⠀⠀⠀⠀⠀:zap:⠀8==:fist:====D:sweat_drops:\n\n'
			+ '⠀⠀⠀ :guitar:⠀⠀⠀⠀:closed_umbrella:\n\n'
			+ '⠀⠀⠀:boot:⠀⠀⠀⠀⠀:boot:\n\n'
			+ `<@${ping_user_id}> <@${ping_user_id}> <@${ping_user_id}>`
		);
	}
});

function connect(): void
{
	if (ps2Socket?.readyState == WebSocket.OPEN)
	{
		log("Warning: Tried opening non-closed connection!");
		return;
	}

	ps2Socket = new WebSocket(URI);

	ps2Socket.onopen = (event) =>
	{
		log('Client Connected');

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
		log('Connection Closed');
	};

	ps2Socket.onerror = event =>
	{
		bot.user?.setPresence(STATUSES.ERROR);
		log("Connection Error: \n" + event.error.message + "\n" + event.error.stack);
		setTimeout(checkTime, 600_000);
	};

	ps2Socket.onmessage = async (event) =>
	{
		let jsonData = JSON.parse(event.data.toString());
		switch (jsonData.type)
		{
			case "serviceMessage":
				// Post Alert
				if (jsonData.payload.metagame_event_state_name == "started")
				{
					if (isTracking) {
						try
						{
							let msg = await CHANNEL.send({ embeds: [jsonToEmbed(jsonData.payload)] });
							curAlerts.set(jsonData.payload.instance_id, msg);
							log(`New Alert (id = ${jsonData.payload.instance_id}): \n'${event.data}'`);
						} 
						catch (error)
						{
							if (typeof error === "string") {
								await DEBUG_CHANNEL.send(`<@${process.env.PING_USER}>\n\`${error}\``);
							} else if (error instanceof Error) {
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
							log(`Alert ended (id = ${jsonData.payload.instance_id}): \n'${event.data}'`);

							curAlerts.delete(jsonData.payload.instance_id);
							if (isTracking == false && curAlerts.size == 0)
							{
								setTimeout(closeConnection, 1_000);
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


function closeConnection(): void
{
	if (ps2Socket == undefined || ps2Socket.readyState == WebSocket.CLOSED)
	{
		log("Warning: Tried closing already closed connection!");
		return;
	}

	log("Closing...")
	ps2Socket.close();
	setTimeout(() =>
	{
		if (ps2Socket.readyState != WebSocket.CLOSED) // hard close
		{
			ps2Socket.terminate();
		}
	}, 10_000);
};

function jsonToEmbed(alert: AlertData): MessageEmbed
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

	let alertEmbed = new MessageEmbed()
		.setThumbnail('https://emoji.gg/assets/emoji/2891_RedAlert.gif')
		.setTitle(alertType.name)
		//.addField("Details:", `[${alertType.description}](https://ps2alerts.com/alert/${alert.world_id}-${alert.instance_id})`)
		.addField("Timeframe", `<t:${startTimeStamp}:t> — <t:${endTimeStamp}:t>`)
		//.addField("Activity Level", popLevel, true)
		//.addField('Territory Control',
		//	 `<:VS:793952227558424586> **VS**: ${scores[0]}%\
		//	\n<:NC:793952194863956018> **NC**: ${scores[1]}%\
		//	\n<:TR:793952210752241665> **TR**: ${scores[2]}%`)
		//.setTimestamp()
		;

	if (alert.metagame_event_state_name == "started")
	{
		alertEmbed.setColor(CONTINENT_COLORS[alert.zone_id]);
	}
	else
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

function checkTime(): void
{
	let now = new Date();
	START_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
	END_DATE.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());

	log(`Checking at: ${now.toLocaleTimeString()} vs ${START_DATE.toLocaleTimeString()}-${END_DATE.toLocaleTimeString()}`);
	if (START_DATE <= now && now < END_DATE) // start checking ?
	{
		if (!isTracking)
		{
			bot.user?.setPresence(STATUSES.CHECKING);
			isTracking = true;
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

		if (ps2Socket?.readyState != WebSocket.CLOSED && curAlerts.size == 0)
		{
			closeConnection();
		}

		let difToStart = START_DATE.getTime() - now.getTime(); // difference now to start time
		if (difToStart < 0 || difToStart > 7_200_000)
		{
			log("Wait 2h");
			setTimeout(checkTime, 7_200_000);
		}
		else
		{
			log(`Wait ${Math.floor(difToStart / 60_000)}mins`);
			setTimeout(checkTime, difToStart + 10_000); // (dif < 2h) -> wait dif + small margin of error
		}
	}
}


bot.login(TOKEN);

// HELPERS
function log(msg: string): void
{
	let date = new Date();
	console.log(`[${date.toLocaleDateString('de-DE')}-${date.toLocaleTimeString('de-DE')}] | ${msg}`);
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
