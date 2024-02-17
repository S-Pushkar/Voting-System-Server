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
        candidatesVoted: []
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

    client = await MongoClient.connect(url);
    try {
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

console.log("Server is listening on port 8080");
app.listen(port);