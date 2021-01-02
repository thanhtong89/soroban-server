const async_mutex = require('async-mutex');
const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5000
const DATABASE = "./private/scores.json";
const MAX_SCORE_ENTRIES = 3;
var fs = require('fs');

var app = express()
app.use(express.json());
app.use(express.static(path.join(__dirname, 'private')));
const mutex = new async_mutex.Mutex();

app.get('/scores', (req, res) => {
    var scoreTally = loadScoresFromDisk(DATABASE);
    if (scoreTally === null) {
        scoreTally = [];
    }
    res.setHeader('Content-Type', 'application/json');
    res.json(scoreTally);
});

// expected format: 
// {name: "name", score: score}
// we will store this into local JSON
// Schema is : {top_scores: {name : {score: score, attempts: attempts}, ...}} . Max ten entries.
// we keep top 10 only.  Attempt count is incremented by the server.
// Scores are cumulative until reset.
app.post('/scores', (req, res) => {
    mutex.acquire()
        .then(release => {
            try {
                handlePost(req, res);
            } finally {
                release();
            }
        });
});

function handlePost(req, res) {
    var scoreTally = loadScoresFromDisk(DATABASE); 
    if (scoreTally === null) {
        scoreTally = {
            "top_scores": {},
        };
    }
    newScoreEntry = req.body;
    console.log("newScore :", newScoreEntry);
    // ignore this post if name is empty or score is zero
    if (newScoreEntry.score === 0 || newScoreEntry.name.length === 0) {
        console.log("Ignoring this score");
        res.json(scoreTally); 
        return;
    }
    var newScoreTally = updateNewScore(newScoreEntry, scoreTally.top_scores);
    console.log("New score table", newScoreTally);
    saveScoresToDisk(DATABASE, newScoreTally); 
    res.json(newScoreTally);
}

function updateNewScore(newEntry, topScores) {
    const name = newEntry.name;
    if (name in topScores) {
        console.log("updating current score entry ");
        topScores[name].score += newEntry.score;
        topScores[name].attempts += 1;
    } else {
        console.log("inserting new score entry ");
        topScores[name] = {
            score : newEntry.score,
            attempts: 1,
        };
    }
    // perform the sorting and trimming
    var newScoreList = [];
    Object.keys(topScores).forEach(name =>  {
       newScoreList.push({"name" : name, "score": topScores[name].score});
    });
    newScoreList.sort((a,b) => {return b["score"] - a["score"]});
    newScoreList = newScoreList.slice(0, MAX_SCORE_ENTRIES);
    
    var result = {"top_scores" : {}};
    newScoreList.forEach(entry => {
        result.top_scores[entry.name] = {score: topScores[entry.name].score, attempts: topScores[entry.name].attempts}
    });
    return result; 
}

function loadScoresFromDisk(path) {
    var raw;
    try { 
        raw = fs.readFileSync(path);
    } catch(err) {
        console.log(`Got error reading file ${path}: ${err}`);
        return null;
    }
    return JSON.parse(raw);
}

function saveScoresToDisk(path, data) {
    fs.writeFileSync(path, JSON.stringify(data));
}

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
