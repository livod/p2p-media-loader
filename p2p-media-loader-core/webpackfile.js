const path = require("path");
const webpack = require("webpack");

const OUTPUT_PATH = "build";

function makeConfig({ libName, entry, mode, output }) {
    return {
        mode,
        entry,
        devtool: 'source-map',
        resolve: {
            extensions: [".ts", ".js"],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: "ts-loader",
                    exclude: /node_modules/,
                },
            ],
        },
        output: {
            filename: libName + ".js",
            path: output || path.resolve(__dirname, OUTPUT_PATH),
        },
        plugins: [
            new webpack.ProvidePlugin({
                Buffer: ["buffer", "Buffer"],
                process: "process/browser",
            }),
        ],
    };
}

module.exports = [
    // makeConfig({
    //     entry: "./lib/browser-init-webpack.ts",
    //     mode: "development",
    //     libName: "p2p-media-loader-core",
    // }),
    // makeConfig({
    //     entry: "./lib/browser-init-webpack.ts",
    //     mode: "production",
    //     libName: "p2p-media-loader-core.min",
    // }),
    makeConfig({
        entry: "./lib/grail.ts",
        mode: "production",
        libName: "grail.min",
    }),
    // makeConfig({
    //     entry: "./lib/share.ts",
    //     mode: "development",
    //     libName: "p2p-share.min",
    //     output: path.resolve('D:\\Code\\FuJinxiang\\快速尝试\\webtorrent')
    // }),
];
