const express = require('express');
const expressWs = require('express-ws');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cors = require('cors');

const app = express();
expressWs(app);
const port = 8080;

let MongoClient = require('mongodb').MongoClient;
const url = process.env.MONGODB_URI;

app.use(bodyParser.json());
app.use(cors());

app.ws("/ws", async (ws, req) => {
    console.log('WebSocket connected');

    // Handle incoming messages from the client
    ws.on('message', (message) => {
        console.log('Received message from client:', message);

    });

    ws.send("Hello from socket");

    ws.on("close", () => {
        console.log("Connection closed");
    });
});

app.post("/sign-up", async (req, res) => {
    const name = req.body.name;
    const email = req.body.email;
    const password = await bcrypt.hash(req.body.password, 10);  // Hashed password
    
    let client = null;
    let dbo = null;
    let collection = null;
    const data = {
        name: name,
        email: email,
        password: password,
        isCandidate: false,
    };
    
    console.log("Signup request:", req.body);

    client = await MongoClient.connect(url);
    try {
        dbo = client.db('Voting-System');
        collection = dbo.collection('Users');
        let dup = await collection.findOne({ email: email });
        if (dup) {
            await client.close();
            res.status(400).send({
                login: false,
                reason: "Already exists"
            });
            return;
        }
        else {
            await collection.insertOne(data);
            const token = jwt.sign(data, 'secret');
            res.json({
                login: true,
                token: token,
                data: data
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

app.post("/log-in", async (req, res) => {
    const email = req.body.email;
    const password = req.body.password;

    let client = null;
    let dbo = null;
    let collection = null;

    console.log("Login request:", req.body);

    try {
        client = await MongoClient.connect(url);
        dbo = client.db('Voting-System');
        collection = dbo.collection('Users');
        const user = await collection.findOne({
            email: email
        });
        if (user) {
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                const token = jwt.sign(user, 'secret');
                await client.close();
                res.json({
                    login: true,
                    token: token,
                    data: user
                });
            }
            else {
                await client.close();
                res.status(400).json({
                    login: false,
                    reason: "Wrong password"
                });
            }
        }
        else {
            await client.close();
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

app.post("/vote", async (req, res) => {
    const token = req.body.token;
    let payload = jwt.verify(token, "secret");
    const candidate = req.body.candidate;
    console.log("Trying to vote for:", candidate);
    // for (let i = 0; i < payload.candidatesVoted.length; i++) {
    //     if (payload.candidatesVoted[i].email === candidate.email) {
    //         return res.status(400).json({
    //             message: "Already voted"
    //         });
    //     }
    // }
    if (candidate.voters.includes(payload.email)) {
        return res.status(400).json({
            message: "Already voted"
        });
    }

    // payload.candidatesVoted.push(candidate);
    const newToken = jwt.sign(payload, "secret");

    let client = null;
    let dbo = null;
    let collection = null;
    try {
        client = await MongoClient.connect(url);
        dbo = client.db("Voting-System");
        collection = dbo.collection("Candidates");
        let doc = await collection.findOne({ email: candidate.email });
        console.log(doc);
        doc.votes += 1;
        doc.voters.push(payload.email);
        // await collection.deleteOne(candidate);
        await collection.deleteOne({ email: candidate.email });
        await collection.insertOne(doc);
        // let candidatesArr = await collection.find().toArray();
        await client.close();
        ////////////////////////////////////////////////////////////////////
        app.emit("Updated");
        ////////////////////////////////////////////////////////////////////
        // let candidates = [];
        // for (let i = 0; i < candidatesArr.length; i++) {
        //     candidates.push({
        //         name: candidatesArr[i].name,
        //         email: candidatesArr[i].email,
        //         votes: candidatesArr[i].votes,
        //         voters: candidatesArr[i].voters,
        //     });
        // }

        res.json({
            token: newToken,
            // candidates: candidates
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

app.post("/register", async (req, res) => {
    const token = req.body.token;

    const candidate = jwt.verify(token, "secret");
    let newPayload = candidate;
    newPayload.isCandidate = true;

    let client = null;
    let dbo = null;
    let collection = null;
    const candidateData = {
        name: candidate.name,
        email: candidate.email,
        votes: 0,
        voters: []
    };
    try {
        client = await MongoClient.connect(url);
        dbo = client.db("Voting-System");
        collection = dbo.collection("Candidates");
        let dup = await collection.findOne({ email: candidateData.email });
        if (!dup)
            await collection.insertOne(candidateData);
        // let candidatesArr = await collection.find().toArray();
        collection = dbo.collection("Users");
        let candidateAcc = await collection.findOne({ email: candidateData.email });
        candidateAcc.isCandidate = true;
        await collection.deleteOne({ email: candidateData.email });
        await collection.insertOne(candidateAcc);
        await client.close();
        ///////////////////////////////////////////////////////////////////
        app.emit("Updated");
        //////////////////////////////////////////////////////////////////
        // let candidates = [];
        // for (let i = 0; i < candidatesArr.length; i++) {
        //     candidates.push({
        //         name: candidatesArr[i].name,
        //         email: candidatesArr[i].email,
        //         votes: candidatesArr[i].votes,
        //         voters: candidatesArr[i].voters
        //     });
        // }
        let newToken = jwt.sign(newPayload, "secret");
        res.json({
            result: "success",
            token: newToken
            // candidates: candidates
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

app.post("/unregister", async (req, res) => {
    const token = req.body.token;

    const payload = jwt.verify(token, "secret");
    let newPayload = payload;
    newPayload.isCandidate = false;
    let client = null;
    let dbo = null;
    let collection = null;
    try {
        client = await MongoClient.connect(url);
        dbo = client.db("Voting-System");
        collection = dbo.collection("Candidates");
        await collection.deleteOne({ email: payload.email });
        // let candidatesArr = await collection.find().toArray();
        await client.close();
        //////////////////////////////////////////////////////////////////
        app.emit("Updated");
        /////////////////////////////////////////////////////////////////
        // let candidates = [];
        // for (let i = 0; i < candidatesArr.length; i++) {
        //     candidates.push({
        //         name: candidatesArr[i].name,
        //         email: candidatesArr[i].email,
        //         votes: candidatesArr[i].votes,
        //         voters: candidatesArr[i].voters
        //     });
        // }
        let newToken = jwt.sign(newPayload, "secret");
        return res.json({
            result: "success",
            token: newToken
            // candidates: candidates
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

app.post("/is-candidate", async (req, res) => {
    const token = req.body.token;
    const payload = jwt.verify(token, "secret");
    console.log("********************************Is a candidate:", payload.isCandidate);
    res.json({
        isCandidate: payload.isCandidate
    });
});

console.log("Server is listening on port 8080");
app.listen(port);