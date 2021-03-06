/* @flow */
'use strict';
// Libraries imports

const express = require('express');
const cors = require('cors')
const bodyParser = require('body-parser');
const startCommandLine = require('./command-line').start;

// Local imports

const movieController = require('./controllers/movie');
const personController = require('./controllers/person');
const commonController = require('./controllers/common');
const rankingController = require('./controllers/ranking');
const adminController = require('./controllers/admin');

const database = require('./database');
const searchIndex = require('./search');

const API_PORT = process.env.PORT || 8080;

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.get('/movies/:id', movieController.getMovie);
app.put('/movies/:id', movieController.saveMovie);
app.get('/movies/search-index/is-empty', movieController.isSearchIndexEmpty);
app.post('/movies/search-index/populate', movieController.populateSearchIndex);
app.post('/movies/search', movieController.search);

app.get('/persons/:id', personController.getPerson);
app.put('/persons/:id', personController.savePerson);
app.get('/persons/search-index/is-empty', personController.isSearchIndexEmpty);
app.post('/persons/search-index/populate', personController.populateSearchIndex);
app.post('/persons/search', personController.search);

app.post('/common/search', commonController.search);

app.get('/movies/rankings/mark', rankingController.getMarkRanking);
app.get('/movies/rankings/date', rankingController.getDateRanking);

app.post('/admin/search/info', adminController.getSearchInfo);
app.post('/admin/search/flush', adminController.flushSearchIndex);
app.post('/admin/search/populate', adminController.populateSearchIndex);
app.post('/admin/search/snapshot', adminController.snapShotSearchIndex);
app.post('/admin/search/replicate', adminController.replicateSearchIndex);

const launchServer = () => {
    app.listen(API_PORT, () => {
        console.log(`API listening on port ${API_PORT}`);
    });
    startCommandLine();
    // Look if we are running on Heroku, if yes, start to build the search index right away !
    if (process.env.DYNO) {
        searchIndex.movies.populate();
        searchIndex.persons.populate();
    }
}

searchIndex.init
.then(launchServer);

console.log('Initializing the API...');
