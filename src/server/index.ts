import * as Express from "express"
import * as AWS from "aws-sdk"
import * as fs from "fs"
import * as BodyParser from "body-parser"

const deviceIds: string[] = [];
const deviceNames: {[key: string]: string} = {};

async function queryAll(client: AWS.DynamoDB.DocumentClient, tableName: string, current: number, period: number, start?: any): Promise<{}> {
    return await new Promise<{}>((resolve: (value: {}) => void, reject: (err: any) => void) => {
        client.scan({
            TableName: tableName,
            ProjectionExpression: "identifier",
            FilterExpression: "#time between :begin and :end",
            ExpressionAttributeNames: {
                "#time": "recordtime"
            },
            ExpressionAttributeValues: {
                ":begin": current - period + 1,
                ":end": current
            },
            ExclusiveStartKey: start
        }, (err: any, data: {}) => {
            if (err) {
                reject(err);
            }
            resolve(data);
        });
    });
}

async function query(client: AWS.DynamoDB.DocumentClient, tableName: string, identifier: string, current: number, period: number): Promise<{}> {
    return await new Promise<{}>((resolve: (value: {}) => void, reject: (err: any) => void) => {
        client.query({
            TableName: tableName,
            ProjectionExpression: "recordtime, temperature",
            KeyConditionExpression: "identifier = :id and #time between :begin and :end",
            ExpressionAttributeNames: {
                "#time": "recordtime"
            },
            ExpressionAttributeValues: {
                ":id": identifier,
                ":begin": current - period + 1,
                ":end": current
            }
        }, (err: any, data: {}) => {
            if (err) {
                reject(err);
            }
            resolve(data);
        });
    });
}

async function writeFile(filePath: string, content: string): Promise<void> {
    return await new Promise<void>(async (resolve: (value: void) => void, reject: (err: any) => void) => {
        fs.writeFile(filePath, content, (err: any) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
            return;
        });
    });
}

async function readFile(filePath: string): Promise<string> {
    return await new Promise<string>(async (resolve: (value: string) => void, reject: (err: any) => void) => {
        fs.readFile(filePath, (err: any, content: Buffer) => {
            if (err) {
                if (err.code === "ENOENT") {
                    resolve("{}");
                    return;
                }
                reject(err);
                return;
            }
            resolve(content.toString("utf-8"));
            return;
        });
    });
}

function getTemp(client: AWS.DynamoDB.DocumentClient, config: any, interval: number, records: number) {
    return async (req: Express.Request, res: Express.Response) => {
        const identifier: string = req.params.identifier;
        const basetime = Date.now();
        const result: number[][] = Array.from({length: records}, () => []);
        const rows: any = await query(client, config.table, identifier, basetime, interval * records);
        for (const row of rows.Items) {
            const index = Math.floor((basetime - row.recordtime) / interval);
            result[index].push(Number(row.temperature.temp));
        }
        res.status(200).json(result.map(temp =>
                                    temp.length > 0 ? (temp.reduce((prev, current) => prev + current) / temp.length).toFixed(2) : 0));
    }
}

async function scan(client: AWS.DynamoDB.DocumentClient, config: any) {
    const baseTime = Date.now();
    let last: any = undefined;
    while (true) {
        const struct: any = await queryAll(client, config.table, baseTime, 24 * 60 * 60 * 1000, last);
        deviceIds.length = 0;
        for (const key of struct.Items) {
            if (deviceIds.indexOf(key.identifier) === -1) {
                deviceIds.push(key.identifier);
            }
        }
        last = struct.LastEvaluatedKey;

        if (!last) {
            break;
        }
    }
}

function devices(_: Express.Request, res: Express.Response) {
    res.status(200).json(deviceIds);
}

function refresh(client: AWS.DynamoDB.DocumentClient, config: any) {
    return async (_: Express.Request, res: Express.Response) => {
        await scan(client, config);
        res.status(200).json({});
    }
}

function names(_: Express.Request, res: Express.Response) {
    res.status(200).json(deviceNames);
}

function setName(req: Express.Request, res: Express.Response) {
    const identifier = req.params.identifier;
    const name: string = req.body.name;
    if (typeof name !== "string") {
        res.status(400).json({});
        return;
    }
    deviceNames[identifier] = name;
    writeFile("names.json", JSON.stringify(deviceNames));
    res.status(200).json({});
}

export async function listen() {
    try {
        const config: any = JSON.parse(await readFile("config/config.json"));
        if (typeof config.region !== "string" || typeof config.table !== "string") {
            console.log("Failed to load config.json.");
            return;
        }

        try {
            const data = JSON.parse(await readFile("config/names.json"));
            for (const key in data) {
                if (typeof data[key] === "string") {
                    deviceNames[key] = data[key];
                }
            }
        } catch(err) {
            if (err.code !== "ENOENT") {
                throw err;
            }
        }
        
        const client = new AWS.DynamoDB.DocumentClient({region: config.region});
        await scan(client, config);

        const app = Express();
        app.use(BodyParser.urlencoded({
            extended: true
        }));
        app.use(BodyParser.json());
        app.use("/", Express.static(process.cwd() + "/view"));
        app.get("/api/refresh", refresh(client, config));
        app.get("/api/names", names);
        app.get("/api/devices", devices);
        app.get("/api/devices/:identifier", getTemp(client, config, 60 * 60 * 1000, 24));
        app.get("/api/devices/:identifier/hours", getTemp(client, config, 60 * 60 * 1000, 24));
        app.get("/api/devices/:identifier/tenminutes", getTemp(client, config, 10 * 60 * 1000, 60));
        app.get("/api/devices/:identifier/minutes", getTemp(client, config, 60 * 1000, 60));
        app.post("/api/devices/:identifier", setName);
        app.use("/api", (_: Express.Request, res: Express.Response) => res.status(404).json({}));
        app.use((_: Express.Request, res: Express.Response) => res.status(404));
        app.listen(8000, function() {
            console.log("サーバーを起動しました。");
        });
    } catch (err) {
        console.log(err);
        console.log("Failed to load config.json.");
        return;
    }
}

listen();
