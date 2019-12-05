require("./static/index.html");
require("./static/index.css");

type ChartList = {
    chart: Chart,
    deviceId: string
}[];

type Mode = "hours" | "tenminutes" | "minutes";
type Labels = {[key: string]: string[]};

const labels: Labels = {
    "hours": Array.from({length: 24}, (_, key) => String(0 - key) + "h"),
    "tenminutes": Array.from({length: 24}, (_, key) => String(0 - key * 10) + "m"),
    "minutes": Array.from({length: 24}, (_, key) => String(0 - key) + "m")
}
const chartList: ChartList = [];
let currentMode: Mode = "hours";
let timer: number = -1;
let deviceName: {[key: string]: string} = {};

async function request(url: string, data?: any): Promise<any> {
    return await new Promise<any>(function(resolve: (value: any) => void, reject: (err: any) => void) {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status !== 200) {
                    alert("エラーが発生しました: " + String(xhr.status));
                    reject(new Error());
                    return;
                }
                const response = xhr.responseText;
                if (response === null) {
                    reject(new Error());
                } else {
                    resolve(JSON.parse(response));
                }
            }
        }
        if (typeof data !== "undefined") {
            xhr.open("post", url);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(JSON.stringify(data));
        } else {
            xhr.open("get", url);
            xhr.send();
        }
    });
}

function makeIntervalLink(label: string, mode: Mode) {
    const element = document.createElement("td");
    element.textContent = label;
    element.onclick = function() {
        currentMode = mode;
        clearTimeout(timer);
        renderLoop();
    };
    return element;
}

function makeOperationLink(label: string, callback: any) {
    const element = document.createElement("td");
    element.textContent = label;
    element.onclick = callback;
    return element;
}

function setName(device: string) {
    return async function() {
        const name = prompt("デバイスの名前を入力してください。", deviceName[device] || "");
        if (name !== null) {
            deviceName[device] = name;
            await request("/api/devices/" + device, {
                name: name
            });
            clearTimeout(timer);
            render(false);
        }
    }
}

async function renderLoop() {
    for (const chart of chartList) {
        const url = "/api/devices/" + encodeURIComponent(chart.deviceId) + "/" + currentMode;
        const data = await request(url);
        chart.chart.data.datasets![0].data = data;
        chart.chart.data.labels = labels[currentMode];
        chart.chart.update();
    }
    timer = window.setTimeout(renderLoop, 60 * 1000);
};

async function render(refresh: boolean) {
    const graph = document.getElementById("graph")!;
    while (graph.firstChild) {
        graph.removeChild(graph.firstChild);
    }

    const intervals = document.createElement("table");
    intervals.setAttribute("class", "option");
    intervals.appendChild(makeIntervalLink("1h", "hours"));
    intervals.appendChild(makeIntervalLink("10m", "tenminutes"));
    intervals.appendChild(makeIntervalLink("1m", "minutes"));
    graph.appendChild(intervals);

    const operations = document.createElement("table");
    operations.setAttribute("class", "option");
    operations.appendChild(makeOperationLink("Refresh devices list", async function() {
        clearTimeout(timer);
        render(true);
    }));
    graph.appendChild(operations);

    const table = document.createElement("table");
    graph.appendChild(table);

    if (refresh) {
        await request("/api/refresh");
        deviceName = await request("/api/names");
    }
    const devices = await request("/api/devices");
    chartList.length = 0;
    for (const deviceId of devices) {
        const url = "/api/devices/" + encodeURIComponent(deviceId);
        const data = await request(url);
        
        const canvas = document.createElement("canvas");
        canvas.width = graph.clientWidth / 2;
        canvas.height = graph.clientHeight / 4;
        const row = document.createElement("div");
        row.setAttribute("class", "row");
        const name = document.createElement("div");
        name.setAttribute("class", "name");
        if (deviceName[deviceId]) {
            name.textContent = deviceId + "(" + deviceName[deviceId] + ")";
        } else {
            name.textContent = deviceId;
        }
        const link = document.createElement("a");
        link.textContent = "[名前の設定]";
        name.textContent = deviceId + (deviceName[deviceId] ? "(" + deviceName[deviceId] + ")" : "");
        link.setAttribute("href", "javascript:void(0);");
        link.onclick = setName(deviceId);
        name.appendChild(link);
        const chartCanvas = document.createElement("div");
        chartCanvas.appendChild(canvas);
        row.appendChild(name);
        row.appendChild(chartCanvas);
        table.appendChild(row);
        const chart = new Chart(canvas, {
            type: "line",
            data: {
                labels: labels[currentMode],
                datasets: [{
                    label: "Temperature",
                    data: data
                }]
            },
            options: {
                scales: {
                    yAxes: [{
                        ticks: {
                            callback: function(label) {
                                return Number(label).toFixed(2);
                            }
                        }
                    }]
                }
            }
        });
        chartList.push({
            chart: chart,
            deviceId: deviceId
        });
    }
    timer = window.setTimeout(renderLoop, 60 * 1000);
}

(async function() {
    deviceName = await request("/api/names");
    await render(false);
})();
