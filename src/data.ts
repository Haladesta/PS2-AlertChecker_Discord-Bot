
// =========  Consts  =========
import {HexColorString, PresenceData} from "discord.js";
import alertTypes from "./static/alerts.json";

export const STATUSES: Record<string, PresenceData> = {
    CHECKING: {
        status: 'online', activities: [{name: 'Checking... 👀'}]
    },
    IDLE: {
        status: 'idle', activities: [{name: 'Sleeping 💤'}]
    },
    ERROR: {
        status: 'dnd', activities: [{name: 'Error: API unavailable'}]
    }
};

export const WORLDS = {
    "Cobalt": 13,
    "Miller": 10,
    "SolTech": 40,
    "Emerald": 17,
    "Connery": 1
};

export const CONTINENTS = {
    2:   {name: "Indar",   color: '#fcda2b' as HexColorString},
    4:   {name: "Hossin",  color: '#b4de2a' as HexColorString},
    6:   {name: "Amerish", color: '#59e632' as HexColorString},
    8:   {name: "Esamir",  color: '#cbd5e1' as HexColorString},
    14:  {name: "Koltyr",  color: '#454545' as HexColorString},
    344: {name: "Oshur",   color: '#168cfa' as HexColorString}
};


export interface AlertData {
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

export interface PS2EventMessage {
    payload: AlertData,
    service: string,
    type: string
}