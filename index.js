const express = require('express');
const app = express();
app.use(express.json());
const http = require('http');
const { connect } = require('http2');
const server = http.createServer(app);
const fs = require('fs');
require('dotenv').config()
var cors = require('cors')
const { v4: uuidv4 } = require('uuid');


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
        connections = Object.fromEntries(Object.entries(connections).filter(([key, value]) => value.socketId !== socket.id));
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
        console.log(command.deviceID)
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
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).send({ message: 'Email, password, and name are required' });
    }

    try {
        // Step 1: Create user in Firebase Authentication
        const userRecord = await getAuth().createUser({
            email,
            password, // Password will automatically be hashed by Firebase Auth
            displayName: name,
        });
        const firebaseAuthId = userRecord.uid;

        console.log('Successfully created Firebase user:', firebaseAuthId);

        // Step 3: Generate a unique ID for the user
        const userId = uuidv4(); // Unique ID for the user document

        // Step 4: Store the user in Firestore
        const userData = {
            id: userId,
            firebaseAuthId,  // Firebase Auth UID
            email,
            name,
            password,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await db.collection('users').doc(userId).set(userData);
        console.log('User document successfully created in Firestore:', userId);

        // Step 5: Respond with success message and user details
        res.status(201).send({
            message: 'User created successfully',
            user: {
                id: userId,
                email: userData.email,
                name: userData.name,
                firebaseAuthId: userData.firebaseAuthId,
            }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).send({ message: 'Error creating user', error: error.message });
    }
});

app.post('/users/login', async (req, res) => {
    const { email, password } = req.body;
    
    console.log("Login Required");

    if (!email || !password) {
        return res.status(400).send('Email and password are required');
    }

    try {
        // Query Firestore to find the user with the given email
        const userSnapshot = await db.collection('users').where('email', '==', email).get();

        if (userSnapshot.empty) {
            return res.status(400).send('Invalid email or password');
        }

        let user = null;
        userSnapshot.forEach(doc => {
            user = doc.data();
        });

        // Compare the plain-text password (Not Recommended in Production)
        if (password === user.password) {
            // Password is correct; send success response
            res.send({
                message: 'Login successful',
                uid: user.id
            });
        } else {
            // Password is incorrect
            return res.status(400).send('Invalid email or password');
        }

    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).send('Error logging in');
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

app.post('/users/:userId/addHeadset', async (req, res) => {
    try {
        // Extract details from the request body
        const { deviceID, deviceName } = req.body;

        // Validate the required fields
        if (!deviceID || !deviceName) {
            return res.status(400).send('deviceID and deviceName are required');
        }

        // Add the new headset to Firestore's "devices" collection
        const newHeadsetRef = await db.collection('devices').add({
            owner: req.params.userId,
            deviceID: deviceID,
            deviceName: deviceName,
            status: 'Offline', // Default status to 'Offline'
            createdAt: Timestamp.now(),
        });

        // Update the user's assignedDevices array in Firestore
        await db.collection('users').doc(req.params.userId).update({
            assignedDevices: FieldValue.arrayUnion(deviceID), // This will add the deviceID to the array or create it if it doesn't exist
        });

        console.log(`Successfully added new headset for user: ${req.params.userId}`);
        res.status(201).send({
            id: newHeadsetRef.id,
            message: 'Headset successfully added and assigned to user',
        });
    } catch (error) {
        console.error('Error adding headset:', error);
        res.status(500).send('Error adding headset');
    }
});

app.post('/users/:userId/deleteUser', async (req, res) => {
    const { userId } = req.params;

    try {
        // Delete the user from Firebase Auth
        // await getAuth().deleteUser(userId);
        // console.log(`Successfully deleted user: ${userId}`);

        // Delete the user document from Firestore
        await db.collection('users').doc(userId).delete();
        console.log(`Successfully deleted user document from Firestore: ${userId}`);

        // Respond with success message
        res.status(200).send({ message: `User with ID ${userId} has been deleted.` });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).send('Error deleting user.');
    }
});


app.post('/users/:id/deleteHeadset/:deviceID', async (req, res) => {
    try {
        const { id, deviceID} = req.params;

        // Get the headset document
        console.log(deviceID)
        let headsetDoc = await db.collection('devices').where('deviceID', '==', deviceID).limit(1).get();


        if (headsetDoc.empty) {
            return res.status(404).send('Headset not found');
        }

        let headsetData
        headsetDoc.forEach(doc => {
            headsetDoc = doc
        });

        headsetData = headsetDoc.data();
        console.log(headsetDoc.id)
        if (headsetData.owner !== id) {
            return res.status(403).send('User is not the owner of the headset');
        }

        // Remove the headset from the user's assignedDevices
        await db.collection('users').doc(id).update({
            assignedDevices: FieldValue.arrayRemove(headsetData.deviceID)
        });

        await db.collection('devices').doc(headsetDoc.id).delete();



        console.log(`Successfully deleted headset ${deviceID} and removed it from user ${id}`);
        res.status(200).send({ message: 'Headset deleted and removed from user successfully' });
    } catch (error) {
        console.error('Error deleting headset:', error);
        res.status(500).send('Error deleting headset');
    }
});

app.post('/users/:id/deleteEstate/:estateID', async (req, res) => {
    try {
        const { id, estateID } = req.params;

        let estateDoc = await db.collection('estates').where('estateID', '==', estateID).limit(1).get();

        if (estateDoc.empty) {
            return res.status(404).send('Estate not found');
        }

        let estateData
        estateDoc.forEach(doc => {
            estateDoc = doc
        });

        estateData = estateDoc.data();
        console.log(estateDoc.id)
        if (estateData.owner !== id) {
            return res.status(403).send('User is not the owner of the estate');
        }

        // Remove the estate from the user's assignedEstates
        await db.collection('users').doc(id).update({
            assignedEstates: FieldValue.arrayRemove(estateData.estateID)
        });

        const devices = await db.collection('devices').where('estateIDs', 'array-contains', estateID).get();

        devices.forEach(async (doc) => {
            await db.collection('devices').doc(doc.id).update({
                estateIDs: FieldValue.arrayRemove(estateID)
            });
        });

        await db.collection('estates').doc(estateDoc.id).delete();

        console.log(`Successfully deleted estate ${estateID} and removed it from user ${id}`);
        res.status(200).send({ message: 'Estate deleted and removed from user successfully' });
    } catch (error) {
        console.error('Error deleting estate:', error);
        res.status(500).send('Error deleting estate');
    }
});

app.post('/users/:id/headsets/:deviceID/addEstate/:estateID', async (req, res) => {
    try {
        const { id, deviceID,estateID } = req.params;

        // Get the headset document
        console.log(deviceID)
        let headsetDoc = await db.collection('devices').where('deviceID', '==', deviceID).limit(1).get();


        if (headsetDoc.empty) {
            return res.status(404).send('Headset not found');
        }

        let headsetData
        headsetDoc.forEach(doc => {
            headsetDoc = doc
        });

        headsetData = headsetDoc.data();

        if (headsetData.owner !== id) {
            return res.status(403).send('User is not the owner of the headset');
        }

        let headset = await db.collection('devices').doc(headsetDoc.id);

        await headset.update({
            estateIDs: FieldValue.arrayUnion(estateID), // This will add the deviceID to the array or create it if it doesn't exist
        });

        res.status(200).send({ message: 'Estate added to device successfully' });
    } catch (error) {
        console.error('Error adding estate:', error);
        res.status(500).send('Error adding estate');
    }
});

app.get('/users/:userId/estates', async (req, res) => {
    try {
        // Fetch the user document to get assignedEstates
        const userSnapshot = await db.collection('users').doc(req.params.userId).get();

        if (!userSnapshot.exists) {
            return res.status(404).send('User not found');
        }

        const assignedEstates = userSnapshot.data().assignedEstates || []; // Default to empty array if not present

        if (assignedEstates.length === 0) {
            return res.send([]); // No assigned estates, return an empty array
        }

        // Fetch estates that match the assigned estate IDs
        const estatesSnapshot = await db.collection('estates')
            .where('estateID', 'in', assignedEstates)
            .get();

        const estates = estatesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        res.send(estates);
    } catch (error) {
        console.error('Error fetching estates:', error);
        res.status(500).send('Error fetching estates');
    }
});

app.get('/users/:userId/headsets/:deviceID/estates', async (req, res) => {
    try {
        // Fetch the user document to get assignedEstates
        const userSnapshot = await db.collection('users').doc(req.params.userId).get();

        if (!userSnapshot.exists) {
            return res.status(404).send('User not found');
        }

        const deviceSnapshot = await db.collection('devices').where('deviceID', '==', req.params.deviceID).get();
        
        if (deviceSnapshot.empty) {
            return res.status(404).send('Device not found');
        }

        let deviceData
        deviceSnapshot.forEach(doc => {
            deviceData = doc.data();
        });

        const assignedEstates = deviceData.estateIDs || []; // Default to empty array if not present

        if (assignedEstates.length === 0) {
            return res.send([]); // No assigned estates, return an empty array
        }

        // Fetch estates that match the assigned estate IDs
        const estatesSnapshot = await db.collection('estates')
            .where('estateID', 'in', assignedEstates)
            .get();

        const estates = estatesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        res.send(estates);
    } catch (error) {
        console.error('Error fetching estates:', error);
        res.status(500).send('Error fetching estates');
    }
});

app.post('/users/:userId/addEstate', async (req, res) => {
    const { estateID, estateName, scenes } = req.body; // Expect estate details in the request body

    // Validate required fields
    if (!estateID || !estateName || !Array.isArray(scenes)) {
        return res.status(400).send('estateID, estateName, and scenes are required');
    }

    try {
        // Create the new estate in the Firestore 'estates' collection
        const estateDoc = await db.collection('estates').add({
            owner: req.params.userId,
            estateID: estateID,
            estateName: estateName,
            scenes: scenes, // Directly assign the scenes array
            status: 'Available', // Default status if not provided
            createdAt: Timestamp.now()
        });

        console.log('Successfully created new estate:', estateDoc.id);

        // Update the user's assignedEstates
        const userRef = db.collection('users').doc(req.params.userId);

        // Use Firestore's arrayUnion to add the new estateID to the assignedEstates
        await userRef.update({
            assignedEstates: FieldValue.arrayUnion(estateID)
        });

        // Respond with success message and estate details
        res.status(201).send({
            id: estateDoc.id,
            message: 'Estate created and assigned successfully',
            estate: {
                estateID: estateID,
                estateName: estateName,
                scenes: scenes, // Include scenes in the response
                status: 'Available',
                createdAt: Timestamp.now()
            }
        });
    } catch (error) {
        console.error('Error adding estate:', error);
        res.status(500).send('Error adding estate'); // Return a 500 status for server errors
    }
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
