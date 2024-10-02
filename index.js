const express = require('express');
const app = express();
const http = require('http');
const { connect } = require('http2');
const server = http.createServer(app);
const fs = require('fs');
require('dotenv').config()
var cors = require('cors')


const { Server } = require("socket.io");
const io = new Server(server,{
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
app.use(cors())

const { initializeApp, cert } = require("firebase-admin/app");

fs.writeFileSync("./vr-realestate-demo-firebase-adminsdk-q9gbz-ef6209c3d7.json", process.env.FIREBASE_SECRET, "utf-8");

var serviceAccount = require("./vr-realestate-demo-firebase-adminsdk-q9gbz-ef6209c3d7.json");

initializeApp({
    credential: cert(serviceAccount)
});

const { getFirestore, Timestamp, FieldValue, Filter } = require('firebase-admin/firestore');
const db = getFirestore();



async function getDb() {
    const snapshot = await db.collection('users').get();
    snapshot.forEach((doc) => {
        console.log(doc.id, '=>', doc.data());
    });
}

// getDb().catch(console.error);


headsetConnections = {}
controllerConnections = {}
connections = {}

io.on('connection', (socket) => {
    console.log('a user connected');
    // console.log(connections);
    socket.on('disconnect', () => {
        console.log('user disconnected');
        headsetConnections = Object.fromEntries(Object.entries(headsetConnections).filter(([key, value]) => value.socketId !== socket.id));
        // console.log(headsetConnections);
    });
    socket.on('headsetStatusUpdate', (msg) => {
        // console.log('message: ' + msg);
        connections[msg] = {
            socketId: socket.id,
            status: "Online",
            connection: "Open"
        };
        // console.log(connections)
        io.emit('deviceStatus', msg);
    })
    // socket.on('controllerConnection', (ownerId) => {
    //     console.log('Owner: ' + ownerId);
    //     controllerConnections[socket.id] = {
    //         owner : ownerId,
    //         status: "Online"
    //     }
    // });

    socket.on('sceneChangeCommand', (command) => { 
        console.log('Scene Change: ' + command.sceneID);
        if(!(command.deviceID in connections)) {
            console.log('Device not connected');
            return;
        }
        let socketId = connections[command.deviceID].socketId;
        io.to(socketId).emit('sceneChange', command.sceneID);
        // io.emit('sceneChange', command);
    })
    socket.on('teleChangeCommand', (command) => { 
        console.log('Tele Change: ' + command.teleID);
        if(!(command.deviceID in connections)) {
            console.log('Device not connected');
            return;
        }
        let socketId = connections[command.deviceID].socketId;
        io.to(socketId).emit('teleChange', command.teleID);
        // io.emit('sceneChange', command);
    })
});

app.get('/', (req, res) => {
    res.send('<h1>Hello world</h1>');
});

app.get('/headsets/:ownerId', async (req, res) => {
    // console.log(req.params.ownerId);
    // console.log()
    const snapshot = await db.collection('devices').where('owner', '==', req.params.ownerId).get();
    let retObj = {}
    // for (const doc of snapshot.docs) {
    //     console.log(doc.id, '=>', doc.data());
    // }
    for (const doc of snapshot.docs) {
        retObj[doc.id] = doc.data();
        if (doc.data().deviceID in connections) {
            retObj[doc.id].status = connections[doc.data().deviceID].status;
        }
        else {
            retObj[doc.id].status = "Offline";
        }
    }
    res.send(retObj);
});

server.listen(3000, () => {
    console.log('listening on *:3000');
});