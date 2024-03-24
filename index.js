const express = require('express');
const expressWs = require('express-ws');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cors = require('cors');
const events = require('events');
const WebSocket = require('ws');

// creating an express server
const app = express();
expressWs(app);
const port = 8080;

// MongoDB connection
let MongoClient = require('mongodb').MongoClient;
const url = process.env.MONGODB_URI;

// enable JSON parsing and CORS
app.use(bodyParser.json());
app.use(cors());

// Event emitter to notify all clients when a change occurs in the database
let em = new events.EventEmitter();

// Array to store all connected WebSocket clients
let socketClients = [];

// WebSocket endpoint to notify clients when a change occurs in the database
app.ws("/ws", async (ws, req) => {
    // Add the new client to the array
    socketClients.push(ws);
    console.log('WebSocket connected');
    
    // Handle incoming messages from the client
    ws.on('message', (message) => {
        console.log('Received message from client:', message);
        
    });
    
    // Notify the client when a change occurs in the database
    em.on("Updated", async () => {
        let client = null;
        let dbo = null;
        let collection = null;
        try {
            // Connect to the Candidates collection in the Voting-System database
            client = await MongoClient.connect(url);
            dbo = client.db("Voting-System");
            collection = dbo.collection("Candidates");
            // Retrieve all candidates from the database
            let candidatesArr = await collection.find().toArray();
            // Close the connection to the database
            await client.close();
            let candidates = [];
            for (let i = 0; i < candidatesArr.length; i++) {
                candidates.push({
                    name: candidatesArr[i].name,
                    email: candidatesArr[i].email,
                    votes: candidatesArr[i].votes,
                    voters: candidatesArr[i].voters,
                });
            }
            console.log(candidates);
            // Broadcast the candidates to all connected clients
            socketClients.forEach((cli) => {
                if (cli.readyState == WebSocket.OPEN) {
                    cli.send(JSON.stringify(candidates));
                }
            })
        }
        catch (err) {
            console.error(err);
        }
    });
    
    // Handle the close event
    ws.on("close", () => {
        console.log("Connection closed");
        // Remove the client from the array when the connection is closed
        socketClients.splice(socketClients.indexOf(ws), 1);
    });
});

// Endpoint to sign up a new user
app.post("/sign-up", async (req, res) => {
    // Extract the name, email, and password from the request body
    const name = req.body.name;
    const email = req.body.email;
    // Hash the password using bcrypt
    const password = await bcrypt.hash(req.body.password, 10);  // Hashed password
    
    let client = null;
    let dbo = null;
    let collection = null;
    // Create a new user object
    const data = {
        name: name,
        email: email,
        password: password,
        isCandidate: false,
    };
    
    console.log("Signup request:", req.body);

    client = await MongoClient.connect(url);
    try {
        // Connect to the Users collection in the Voting-System database
        dbo = client.db('Voting-System');
        collection = dbo.collection('Users');
        // Check if the user already exists with the given email
        let dup = await collection.findOne({ email: email });
        if (dup) {
            await client.close();
            // Return an error response if the user already exists
            res.status(400).send({
                login: false,
                reason: "Already exists"
            });
            return;
        }
        else {
            // Insert the new user into the database
            await collection.insertOne(data);
            const tokenData = {
                name: name,
                email: email,
                isCandidate: false
            };
            // Create a JWT token for the new user
            const token = jwt.sign(tokenData, 'secret');
            ///////////////////////////////////////////////////////
            // Notify all connected clients whenever a change occurs in the database
            em.emit("Updated");
            ///////////////////////////////////////////////////////
            // Return the token to the client in JSON format
            res.json({
                login: true,
                token: token
            });
            return;
        }
    }
    catch(err) {
        await client.close();
        res.status(500).json({
            login: false
        });
    }
});

// Endpoint to log in an existing user
app.post("/log-in", async (req, res) => {
    // Extract the email and password from the request body
    const email = req.body.email;
    const password = req.body.password;

    let client = null;
    let dbo = null;
    let collection = null;

    console.log("Login request:", req.body);

    try {
        // Connect to the Users collection in the Voting-System database
        client = await MongoClient.connect(url);
        dbo = client.db('Voting-System');
        collection = dbo.collection('Users');
        // Find the user with the given email
        const user = await collection.findOne({
            email: email
        });
        if (user) {
            // Compare the hashed password with the given password
            const match = await bcrypt.compare(password, user.password);
            // If the password matches, create a JWT token for the user
            if (match) {
                const tokenData = {
                    name: user.name,
                    email: user.email,
                    isCandidate: user.isCandidate
                };
                // Create a JWT token for the user with name, email, and isCandidate fields
                const token = jwt.sign(tokenData, 'secret');
                await client.close();
                ///////////////////////////////////////////////////////
                // Notify all connected clients whenever a change occurs in the database
                em.emit("Updated");
                ///////////////////////////////////////////////////////
                // Return the token to the client in JSON format
                res.json({
                    login: true,
                    token: token
                });
            }
            else {
                await client.close();
                // Return an error response if the password is incorrect
                res.status(400).json({
                    login: false,
                    reason: "Wrong password"
                });
            }
        }
        else {
            await client.close();
            // Return an error response if the user does not exist with the given email
            res.status(400).json({
                login: false,
                reason: "Wrong email or password"
            });
        }
    }
    catch (err) {
        await client.close();
        res.status(500).json({
            login: false,
            reason: "Unknown"
        });
    }
});

// Endpoint for a user to vote for a candidate
app.post("/vote", async (req, res) => {
    // Extract the token from the request body
    const token = req.body.token;
    if (!token) {
        // Return an error response if the token is missing
        return res.status(403).json({
            message: "Not authorized"
        });
    }
    // Verify the token using the secret key
    let payload = jwt.verify(token, "secret");
    // Extract the candidate(to vote for) from the request body
    const candidate = req.body.candidate;
    console.log("Trying to vote for:", candidate);
    
    if (candidate.voters.includes(payload.email)) {
        // Return an error response if the user has already voted for the candidate
        return res.status(400).json({
            message: "Already voted"
        });
    }
    // Create a new token with the updated payload
    const newToken = jwt.sign(payload, "secret");

    let client = null;
    let dbo = null;
    let collection = null;
    try {
        // Connect to the Candidates collection in the Voting-System database
        client = await MongoClient.connect(url);
        dbo = client.db("Voting-System");
        collection = dbo.collection("Candidates");
        // Find the candidate in the database
        let doc = await collection.findOne({ email: candidate.email });
        console.log(doc);
        // Increment the votes count and add the voter's email to the voters array
        doc.votes += 1;
        doc.voters.push(payload.email);
        // Update the candidate in the database
        await collection.deleteOne({ email: candidate.email });
        await collection.insertOne(doc);
        
        await client.close();
        ////////////////////////////////////////////////////////////////////
        // Notify all connected clients whenever a change occurs in the database
        em.emit("Updated");
        ////////////////////////////////////////////////////////////////////

        // Return the new token to the client in JSON format
        res.json({
            token: newToken
        });
    }
    catch (err) {
        console.log(err);
        await client.close();
        res.status(500).json({
            token: token
        });
    }
});

// Endpoint to register a candidate
app.post("/register", async (req, res) => {
    // Extract the token from the request body
    const token = req.body.token;
    if (!token) {
        // Return an error response if the token is missing
        return res.status(403).json({
            message: "Not authorized"
        });
    }
    // Verify the token using the secret key and get the payload
    const candidate = jwt.verify(token, "secret");
    let newPayload = candidate;
    newPayload.isCandidate = true;

    let client = null;
    let dbo = null;
    let collection = null;
    // Create a new candidate object
    const candidateData = {
        name: candidate.name,
        email: candidate.email,
        votes: 0,
        voters: []
    };
    try {
        // Connect to the Candidates collection in the Voting-System database
        client = await MongoClient.connect(url);
        dbo = client.db("Voting-System");
        collection = dbo.collection("Candidates");
        // Check if the candidate already exists with the given email
        let dup = await collection.findOne({ email: candidateData.email });
        if (!dup)
            // Insert the new candidate into the database if it does not exist
            await collection.insertOne(candidateData);
        
        // Connect to the Users collection in the Voting-System database
        collection = dbo.collection("Users");
        // Find the user with the given email
        let candidateAcc = await collection.findOne({ email: candidateData.email });
        // Update the user to be a candidate
        candidateAcc.isCandidate = true;
        // Update the user in the database
        await collection.deleteOne({ email: candidateData.email });
        await collection.insertOne(candidateAcc);
        await client.close();
        ///////////////////////////////////////////////////////////////////
        // Notify all connected clients whenever a change occurs in the database
        em.emit("Updated");
        //////////////////////////////////////////////////////////////////

        // Create a new token with the updated payload
        let newToken = jwt.sign(newPayload, "secret");
        res.json({
            result: "success",
            token: newToken
        });
        console.log(candidateData, "is successfully registered.");
    }
    catch (err) {
        await client.close();
        res.status(500).json({
            result: "failure"
        });
    }
});

// Endpoint to unregister a candidate
app.post("/unregister", async (req, res) => {
    // Extract the token from the request body
    const token = req.body.token;
    if (!token) {
        // Return an error response if the token is missing
        return res.status(403).json({
            message: "Not authorized"
        });
    }
    // Verify the token using the secret key and get the payload
    const payload = jwt.verify(token, "secret");
    let newPayload = payload;
    // Create a new payload with isCandidate set to false
    newPayload.isCandidate = false;
    let client = null;
    let dbo = null;
    let collection = null;
    try {
        // Connect to the Candidates collection in the Voting-System database
        client = await MongoClient.connect(url);
        dbo = client.db("Voting-System");
        collection = dbo.collection("Candidates");
        // Delete the candidate from the database
        await collection.deleteOne({ email: payload.email });

        // Connect to the Users collection in the Voting-System database
        collection = dbo.collection("Users");
        // Find the user with the given email
        let doc = await collection.findOne({ email: payload.email });
        // Update the user to be a non-candidate in the database
        doc.isCandidate = false;
        await collection.deleteOne({ email: payload.email });
        await collection.insertOne(doc);
        
        await client.close();
        //////////////////////////////////////////////////////////////////
        // Notify all connected clients whenever a change occurs in the database
        em.emit("Updated");
        /////////////////////////////////////////////////////////////////
        
        // Create a new token with the updated payload and return it to the client
        let newToken = jwt.sign(newPayload, "secret");
        return res.json({
            result: "success",
            token: newToken
        });
    }
    catch (err) {
        console.log("######################", err);
        await client.close();
        res.status(500).json({
            result: "failure"
        });
    }
});

// Endpoint to check if a user is a candidate
app.post("/is-candidate", async (req, res) => {
    // Extract the token from the request body
    const token = req.body.token;
    if (!token) {
        // Return an error response if the token is missing
        return res.status(403).json({
            message: "Not authorized"
        });
    }
    // Verify the token using the secret key and get the payload
    const payload = jwt.verify(token, "secret");
    console.log(payload.email, "is a candidate:", payload.isCandidate);
    //////////////////////////////////////////////////////////////
    // Notify all connected clients
    em.emit("Updated");
    //////////////////////////////////////////////////////////////
    // Return whether the user is a candidate or not
    res.json({
        isCandidate: payload.isCandidate
    });
});

// The server listens on port 8080
console.log("Server is listening on port 8080");
app.listen(port);