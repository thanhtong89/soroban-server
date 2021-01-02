const async_mutex = require('async-mutex');
const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5000
const DATABASE = "./private/scores.json";
const DATABASE_PREV = "./private/scores_prev.json";

const MAX_SCORE_ENTRIES = 3;
var fs = require('fs');

var app = express()
app.use(express.json());
app.use(express.static(path.join(__dirname, 'private')));
const mutex = new async_mutex.Mutex();

var nextResetDate = getNextResetDate();

app.get('/reset-date', (req, res) => {
    const answer = {
        "nextResetDate" : nextResetDate,
    }
    res.setHeader('Content-Type', 'application/json');
    res.json(answer);
});

app.get('/scores/prev', (req, res) => {
    var scoreTally = loadScoresFromDisk(DATABASE);
    if (scoreTally === null) {
        scoreTally = {"top_scores" : {}};
    }
    res.setHeader('Content-Type', 'application/json');
    res.json(scoreTally);
});

app.get('/scores', (req, res) => {
    var scoreTally = loadScoresFromDisk(DATABASE);
    if (scoreTally === null) {
        scoreTally = {"top_scores" : {}};
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

// obtains the time to next score reset
function getNextResetDate() {
    const now = new Date();
    const next = new Date(now.getFullYear(), (now.getMonth() + 1) % 12, 1);
//    const next = new Date(now.getTime() + 1*10000);
    return next;
}

function resetScore(path) {
    mutex.acquire()
        .then(release => {
            try {
                currentScores = loadScoresFromDisk(DATABASE);
                saveScoresToDisk(DATABASE_PREV, currentScores);
                // purge the new score
                try {
                    fs.unlinkSync(DATABASE);
                }
                catch (error) {
                    console.log("Database is already deleted");
                }
                console.log("Purged old database");
            } finally {
                release();
            }
         });
}

function watchAndResetScores() {
    const now = new Date();
    if (now > nextResetDate) {
        console.log("Will reset scores...");
        resetScore();
        nextResetDate = getNextResetDate();
        console.log("New reset date = ", nextResetDate);
    } else {
        console.log("Checking if need to reset ");
    }
}

setInterval(watchAndResetScores, 5000);

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
