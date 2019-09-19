const path = require("path");
const nodeExternals = require('webpack-node-externals');

module.exports = {
    mode: "production",
    entry: "./src/client/index.ts",
    target: "node",
    module: {
        rules: [{
            test: /\.ts$/,
            use: "ts-loader"
        },{
            test: /\.(css|html)$/,
            use: [{
                loader: "file-loader",
                options: {
                    name: "[name].[ext]"
                }
            }]
        }]
    },
    resolve: {
        extensions: [".ts"]
    },
    output: {
        filename: "index.js",
        path: path.join(__dirname, "view")
    }
};
