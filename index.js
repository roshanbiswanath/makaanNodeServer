const express = require('express');
const app = express();
const http = require('http');
const { connect } = require('http2');
const server = http.createServer(app);
const fs = require('fs');
require('dotenv').config()

const { Server } = require("socket.io");
const io = new Server(server);

const { initializeApp, cert } = require("firebase-admin/app");

console.log(process.env.FIREBASE_SECRET);
// Write the Firebase Console service account key JSON to a file
fs.writeFileSync("./vr-realestate-demo-firebase-adminsdk-q9gbz-ef6209c3d7.json", process.env.FIREBASE_SECRET, "utf-8");



// Fetch the service account key JSON file contents
var serviceAccount = require("./vr-realestate-demo-firebase-adminsdk-q9gbz-ef6209c3d7.json");

// Initialize the app with a custom auth variable, limiting the server's access
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

getDb().catch(console.error);


headsetConnections = {}
controllerConnections = {}
connections = {}

io.on('connection', (socket) => {
    console.log('a user connected');
    console.log(connections);
    socket.on('disconnect', () => {
        console.log('user disconnected');
        headsetConnections = Object.fromEntries(Object.entries(headsetConnections).filter(([key, value]) => value.socketId !== socket.id));
        console.log(headsetConnections);
    });
    socket.on('headsetStatusUpdate', (msg) => {
        console.log('message: ' + msg);
        connections[msg] = {
            socketId: socket.id,
            status: "Online",
            connection: "Open"
        };
        console.log(connections)
        io.emit('deviceStatus', msg);
    })
    // socket.on('controllerConnection', (ownerId) => {
    //     console.log('Owner: ' + ownerId);
    //     controllerConnections[socket.id] = {
    //         owner : ownerId,
    //         status: "Online"
    //     }
    // });
});

app.get('/', (req, res) => {
    res.send('<h1>Hello world</h1>');
});

app.get('/headSets', (req, res) => {

    res.send(headsetConnections);
});

server.listen(3000, () => {
    console.log('listening on *:3000');
});