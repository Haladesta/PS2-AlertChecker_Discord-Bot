
export function dateToLocaleTimeString(date: Date) {
    return date.toLocaleTimeString("de-DE", {"hour12": false, "hour": "2-digit", "minute": "2-digit"})
}

export function dateToLocaleString(date: Date) {
    return date.toLocaleString("de-DE", {
        "month": "2-digit",
        "day": "2-digit",
        "hour12": false,
        "hour": "2-digit",
        "minute": "2-digit"
    })
}

export enum log_level {
    info = 0,
    warn = 1,
    error = 2
}

export function log(msg: string, level: log_level = log_level.info): void {
    const timestamp = dateToLocaleString(new Date());
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

export function indexOfMax(arr: Array<number>): number {
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

export function leadZero(num: number): string {
    if (num < 10)
        return `0${num}`;
    else
        return `${num}`;
}
