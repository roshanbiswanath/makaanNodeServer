const express = require('express');
const app = express();
app.use(express.json());
const http = require('http');
const { connect } = require('http2');
const server = http.createServer(app);
const fs = require('fs');
require('dotenv').config()
var cors = require('cors')


const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
app.use(cors())

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

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
        if (!(command.deviceID in connections)) {
            console.log('Device not connected');
            return;
        }
        let socketId = connections[command.deviceID].socketId;
        io.to(socketId).emit('sceneChange', command.sceneID);
        // io.emit('sceneChange', command);
    })

    socket.on('teleChangeCommand', (command) => {
        console.log('Tele Change: ' + command.teleID);
        if (!(command.deviceID in connections)) {
            console.log('Device not connected');
            return;
        }
        let socketId = connections[command.deviceID].socketId;
        io.to(socketId).emit('teleChange', command.teleID);
        // io.emit('sceneChange', command);
    })

});

app.get('/allUsers', async (req, res) => {
    const snapshot = await db.collection('users').get();
    let retObj = {}
    for (const doc of snapshot.docs) {
        retObj[doc.id] = doc.data();
    }
    res.send(retObj);
});

app.get('/users/:userId', async (req, res) => {
    const snapshot = await db.collection('users').doc(req.params.userId).get();
    res.send(snapshot.data());
});

app.post('/users/createUser', async (req, res) => {
    try {
        // Create a new user with Firebase Auth
        const userRecord = await getAuth().createUser({
            email: req.body.email,
            emailVerified: false,
            password: req.body.password,
            name: req.body.name,
        });

        console.log('Successfully created new user:', userRecord.uid);

        // Add the user to Firestore
        await db.collection('users').doc(userRecord.uid).set({
            email: req.body.email,
            name: req.body.name,
            createdAt: Timestamp.now(),
            // You can add other user fields here if needed
        });

        // Respond with the user record
        res.send(userRecord);
    } catch (error) {
        console.error('Error creating new user:', error);
        res.status(500).send(error); // Return a 500 status for server errors
    }
});


app.get('/users/:userId/headsets', async (req, res) => {
    const snapshot = await db.collection('devices').where('owner', '==', req.params.userId).get();
    let retObj = {}
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

app.get('/users/:userId/addHeadset', async (req, res) => {
    const snapshot = await db.collection('devices').add({
        
        owner: req.params.userId
    });
    res.send(snapshot);
});

app.get('/users/:userId/estates', async (req, res) => {
    const snapshot = await db.collection('estates').where('owner', '==', req.params.userId).get();
    let retObj = {}
    for (const doc of snapshot.docs) {
        retObj[doc.id] = doc.data();
    }
    res.send(retObj);
});


app.get('/', (req, res) => {
    res.send('<h1>Hello world</h1>');
});

app.get('/headsets', async (req, res) => {
    const snapshot = await db.collection('devices').get();
    let retObj = {}
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

app.post('/createHeadset', async (req, res) => {
    try {
        const { deviceID, deviceName, status } = req.body; // Accept deviceID, deviceName, and status

        // Validate required fields
        if (!deviceID || !deviceName) {
            return res.status(400).send('deviceID and deviceName are required');
        }

        // Add the new headset to Firestore
        const headsetDoc = await db.collection('devices').add({
            deviceID: deviceID,
            deviceName: deviceName,
            status: status || 'Offline', // Default status if not provided
            createdAt: Timestamp.now()
        });

        console.log('Successfully created new headset:', headsetDoc.id);
        res.status(201).send({ id: headsetDoc.id, message: 'Headset created successfully' });
    } catch (error) {
        console.error('Error creating new headset:', error);
        res.status(500).send('Error creating headset'); // Return a 500 status for server errors
    }
});


app.get('/activeHeadsetsCount', async (req, res) => {
    retObj = {
        activeCount: Object.keys(connections).length,
        totalCount: 0
    }
    const snapshot = await db.collection('devices').get();
    retObj.totalCount = snapshot.size;
    res.send(retObj);
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

app.get('/estates', async (req, res) => {
    try {
        const snapshot = await db.collection('estates').get();
        let retObj = {};
        for (const doc of snapshot.docs) {
            retObj[doc.id] = doc.data();
        }
        res.send(retObj);
    } catch (error) {
        console.error('Error retrieving estates:', error);
        res.status(500).send('Error retrieving estates');
    }
});

app.post('/createEstate', async (req, res) => {
    try {
        const { estateID, estateName, status } = req.body; // Accept relevant estate details

        // Validate required fields
        if (!estateID || !estateName) {
            return res.status(400).send('estateID and estateName are required');
        }

        // Add the new estate to Firestore
        const estateDoc = await db.collection('estates').add({
            estateID: estateID,
            estateName: estateName,
            status: status || 'Available', // Default status if not provided
            createdAt: Timestamp.now()
        });

        console.log('Successfully created new estate:', estateDoc.id);
        res.status(201).send({ id: estateDoc.id, message: 'Estate created successfully' });
    } catch (error) {
        console.error('Error creating new estate:', error);
        res.status(500).send('Error creating estate'); // Return a 500 status for server errors
    }
});


server.listen(3000, () => {
    console.log('listening on *:3000');
});