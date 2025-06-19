const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const fca = require('ws3-fca');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

let botConfig = {};
let lockedGroups = {};
let lockedNicknames = {};

try {
    lockedGroups = JSON.parse(fs.readFileSync('groupLocks.json', 'utf8'));
    lockedNicknames = JSON.parse(fs.readFileSync('nicknameLocks.json', 'utf8'));
} catch {
    console.log('ℹ️ No saved locks found. Continuing without restoring locks.');
}

// 🌐 Web UI with style
app.get('/', (req, res) => {
    res.send(`
    <html>
    <head>
        <title>DARKSTAR TOOL</title>
        <style>
            body {
                background: radial-gradient(circle, #111111, #000000);
                color: #00ffcc;
                font-family: 'Segoe UI', sans-serif;
                text-align: center;
                padding: 30px;
                animation: glow 4s ease-in-out infinite;
            }
            @keyframes glow {
                0%, 100% { background-color: #111; color: #00ffcc; }
                50% { background-color: #222; color: #0ff; }
            }
            h1 {
                color: #ff4444;
                text-shadow: 0 0 10px red;
                font-size: 2.5em;
                animation: flicker 1s infinite alternate;
            }
            @keyframes flicker {
                from { opacity: 1; }
                to { opacity: 0.6; }
            }
            form input, form textarea {
                padding: 10px;
                margin: 10px;
                width: 80%;
                border: 2px solid #0ff;
                background: #000;
                color: #0ff;
                border-radius: 8px;
            }
            button {
                padding: 10px 20px;
                font-size: 16px;
                background: #ff0066;
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
            }
            button:hover {
                background: #ff3366;
            }
            footer {
                position: fixed;
                bottom: 10px;
                width: 100%;
                text-align: center;
                color: #888;
            }
        </style>
    </head>
    <body>
        <h1>🔥 DARKSTAR TOOL ON FIRE 🔥</h1>
        <h2>💬 Messenger Bot Config</h2>
        <form method="POST" action="/configure">
            <input name="adminID" placeholder="Admin Facebook ID" required><br>
            <input name="prefix" value="!" placeholder="Command Prefix" required><br>
            <textarea name="appstate" rows="10" cols="60" placeholder="Paste appstate JSON array..." required></textarea><br>
            <button type="submit">🚀 Start Bot</button>
        </form>
        <footer>👨‍💻 Code by Alex Khan</footer>
    </body>
    </html>
    `);
});

app.post('/configure', (req, res) => {
    const { adminID, prefix, appstate } = req.body;
    botConfig = { adminID, prefix };

    try {
        const parsed = JSON.parse(appstate);
        if (!Array.isArray(parsed)) throw new Error('AppState is not an array');

        fs.writeFileSync('appstate.json', JSON.stringify(parsed, null, 2));
        console.log('📄 [INFO] appstate.json saved.');
        res.send('<h2 style="color:lime">✅ Bot is starting... Check terminal logs.</h2>');
        startBot();
    } catch (err) {
        console.error('❌ Invalid AppState JSON:', err.message);
        res.send('<h2 style="color:red">❌ Invalid AppState format. Please check your input.</h2>');
    }
});

function saveLocks() {
    fs.writeFileSync('groupLocks.json', JSON.stringify(lockedGroups, null, 2));
    fs.writeFileSync('nicknameLocks.json', JSON.stringify(lockedNicknames, null, 2));
}

function startBot() {
    let appState;
    try {
        appState = JSON.parse(fs.readFileSync('appstate.json', 'utf8'));
        console.log('📄 [INFO] appstate.json loaded successfully.');
    } catch (err) {
        console.error('❌ Failed to load appstate.json:', err);
        return;
    }

    fca.login(appState, (err, api) => {
        if (err) {
            console.error('❌ Login failed:', err);
            return;
        }

        api.setOptions({ listenEvents: true });

        api.getUserInfo(api.getCurrentUserID(), (err, info) => {
            if (!err && info) {
                const name = info[api.getCurrentUserID()].name;
                console.log(`🤖 Logged in as: ${name}`);
            }
        });

        api.listenMqtt((err, event) => {
            if (err) return console.error('❌ Listen error:', err);

            if (event.type === 'message' && event.body) {
                const threadID = event.threadID;
                const senderID = event.senderID;
                const msg = event.body.trim();
                console.log(`📨 [${threadID}] ${senderID}: ${msg}`);
            }

            if (event.type === 'message' && event.body?.startsWith(botConfig.prefix)) {
                const senderID = event.senderID;
                const args = event.body.slice(botConfig.prefix.length).trim().split(' ');
                const command = args[0]?.toLowerCase();

                if (senderID !== botConfig.adminID) {
                    return api.sendMessage('❌ Unauthorized user.', event.threadID);
                }

                if (command === 'grouplockname' && args[1] === 'on') {
                    const groupName = args.slice(2).join(' ');
                    lockedGroups[event.threadID] = groupName;
                    saveLocks();
                    api.setTitle(groupName, event.threadID, (err) => {
                        if (err) return api.sendMessage('❌ Failed to lock group name.', event.threadID);
                        api.sendMessage(`✅ Group name locked as: ${groupName}`, event.threadID);
                    });
                }

                if (command === 'nicknamelock' && args[1] === 'on') {
                    const nickname = args.slice(2).join(' ');
                    lockedNicknames[event.threadID] = nickname;
                    saveLocks();
                    api.getThreadInfo(event.threadID, (err, info) => {
                        if (err) return api.sendMessage('❌ Failed to get thread info.', event.threadID);
                        info.participantIDs.forEach((uid) => {
                            api.changeNickname(nickname, event.threadID, uid);
                        });
                        api.sendMessage(`✅ Nicknames locked as: ${nickname}`, event.threadID);
                    });
                }

                if (command === 'ping') {
                    api.sendMessage('✅ Pong!', event.threadID);
                }

                if (command === 'help') {
                    const cmds = [
                        '🔧 grouplockname on <name>',
                        '🔧 nicknamelock on <nickname>',
                        '🔧 ping',
                        '🔧 help'
                    ].join('\n');
                    api.sendMessage(`🤖 Available Commands:\n${cmds}`, event.threadID);
                }
            }

            // 🔐 Enforce locked group name (only admin allowed to change)
            if (event.logMessageType === 'log:thread-name') {
                const lockedName = lockedGroups[event.threadID];
                const changerID = event.author;

                if (lockedName && changerID !== botConfig.adminID) {
                    api.setTitle(lockedName, event.threadID);
                    api.sendMessage('❌ Only admin can change group name. Lock restored.', event.threadID);
                }
            }

            // 🔁 Auto-restore nickname on unauthorized change (optional)
            if (event.logMessageType === 'log:thread-nickname') {
                const lockedNick = lockedNicknames[event.threadID];
                const userID = event.logMessageData.participant_id;
                if (lockedNick) {
                    api.changeNickname(lockedNick, event.threadID, userID);
                }
            }
        });
    });
}

app.listen(3000, () => {
    console.log('🌐 Server running at http://localhost:3000');
});
