"use strict";

// Libraries imports

const Promise = require('bluebird');
const searchIndex = Promise.promisify(require('search-index')); // Promisify search-index
const stopwords = require('term-vector').getStopwords('fr').sort(); // Get the french stopwords
const da = require('distribute-array'); // Used to make indexation batches
const _ = require('lodash');
const fs = require('fs');

// Local imports

const getAllMovies = require('../database').getAllMovies;
const batchify = require('./common').batchify;
const sequencify = require('./common').sequencify;
const indexBatch = require('./common').indexBatch;
const initSearchIndex = require('./common').initSearchIndex;
const checkIsIndexEmpty = require('./common').checkIsIndexEmpty;
const promisifySearchIndex = require('./common').promisifySearchIndex;
const treatSearchResults = require('./common').treatSearchResults;
const groupedSearch = require('./common').groupedSearch;
const buildSearchQuery = require('./common').buildSearchQuery;
const copyFacetsLabelsIntoCodesIfNeeded = require('./common').copyFacetsLabelsIntoCodesIfNeeded;

// Local references

let movieSearchIndex;

// Configuration

const movieIndexOptions = {
    indexPath: 'storage/search-movies',
    fieldsToStore: [
        'code',
        'title',
        'originalTitle',
        'keywords',
        'poster',
        'runtime',
        'movieType',
        'productionYear',
        'userRating',
        'pressRating'
    ],
    fieldedSearch: false,
    deletable: false,
    stopwords
};

const movieBatchOptions = {
    fieldOptions: [
        {
            fieldName: 'code',
            searchable: false
        },
        {
            fieldName: 'title',
            filter: true
        },
        {
            fieldName: 'movieType',
            filter: true,
            searchable: false
        },
        {
            fieldName: 'productionYear',
            filter: true,
            searchable: false
        }
    ]
};

const movieFacetsToFieldName = {
    FCT_MOVIE_TYPE: 'movieType',
    FCT_MOVIE_TITLE: 'title',
    FCT_MOVIE_YEAR: 'productionYear'
}

const movieFacets = copyFacetsLabelsIntoCodesIfNeeded({
    FCT_MOVIE_TITLE: {
        fieldName: 'title',
        ranges: [
            {
                code: 'R1',
                value: ['', '9'],
                label: '#'
            },
            {
                code: 'R2',
                value: ['A', 'G'],
                label: 'A-G'
            },
            {
                code: 'R3',
                value: ['H', 'N'],
                label: 'H-N'
            },
            {
                code: 'R4',
                value: ['O', 'T'],
                label: 'O-T'
            },
            {
                code: 'R5',
                value: ['U', 'Z'],
                label: 'U-Z'
            }
        ]
    },
    FCT_MOVIE_TYPE: {
        fieldName: 'movieType'
    },
    FCT_MOVIE_YEAR: {
        fieldName: 'productionYear',
        ranges: [
            {
                code: 'R1',
                value: ['', '1930'],
                label: 'Avant 1930'
            },
            {
                code: 'R2',
                value: ['1931', '1940'],
                label: 'Années 30'
            },
            {
                code: 'R3',
                value: ['1941', '1950'],
                label: 'Années 40'
            },
            {
                code: 'R4',
                value: ['1951', '1960'],
                label: 'Années 50'
            },
            {
                code: 'R5',
                value: ['1961', '1970'],
                label: 'Années 60'
            },
            {
                code: 'R6',
                value: ['1971', '1980'],
                label: 'Années 70'
            },
            {
                code: 'R7',
                value: ['1981', '1990'],
                label: 'Années 80'
            },
            {
                code: 'R8',
                value: ['1991', '2000'],
                label: 'Années 90'
            },
            {
                code: 'R9',
                value: ['2001', '2010'],
                label: 'Années 2000'
            },
            {
                code: 'R10',
                value: ['2011', Number.MAX_SAFE_INTEGER.toString()],
                label: 'Après 2010'
            }
        ]
    }
});

const BATCH_SIZE = 50;

// Pure functions

const getMovies = () => getAllMovies()
.then(movies => movies.map(movie => ({
    code: movie.code,
    title: [movie.title],
    originalTitle: movie.originalTitle,
    keywords: movie.keywords,
    poster: movie.poster,
    runtime: movie.runtime,
    movieType: [movie.movieType],
    productionYear: [movie.productionYear],
    userRating: movie.userRating,
    pressRating: movie.pressRating
})));

const fillMovieIndex = (si, batchOptions, batchSize) => getMovies()
.then(movies => batchify(movies, batchSize))
.then(batches => sequencify(batches, (batch, batchIndex) => indexBatch(si, batch, batchOptions, batchIndex, batches.length)))

// Stateful functions

const init = initSearchIndex(searchIndex, movieIndexOptions)
.then(promisifySearchIndex)
.then(si => {
    movieSearchIndex = si;
    return Promise.resolve();
});

const snapShot = () => new Promise((resolve, reject) => {
    movieSearchIndex.snapShot(readStream => {
        readStream.pipe(fs.createWriteStream('storage/movie-backup.gz'))
        .on('close', resolve);
    });
});

const replicate = () => new Promise((resolve, reject) => {
    movieSearchIndex.flush(err => {
        if (err) reject(err);
        movieSearchIndex.replicate(fs.createReadStream('storage/movie-backup.gz'), resolve);
    });
});

const parseMovies = movies => movies.map(movie => ({
    code: movie.code,
    keywords: movie.keywords,
    movieType: movie.movieType.join(''),
    originalTitle: movie.originalTitle,
    pressRating: movie.pressRating,
    productionYear: movie.productionYear.join(''),
    runtime: movie.runtime,
    title: movie.title.join(''),
    userRating: movie.userRating
}))

const checkIsMovieIndexEmpty = () => init
.then(() => checkIsIndexEmpty(movieSearchIndex));

const populate = () => init
.then(() => fillMovieIndex(movieSearchIndex, movieBatchOptions, BATCH_SIZE))

const search = (text, selectedFacets, group, sortFieldName, sortDesc, top, skip, groupTop) => init
.then(() => movieSearchIndex.tellMeAboutMySearchIndex())
.then(infos => {
    if (infos.totalDocs === 0) throw new Error('Movie search index is empty');
})
.then(() => {
    const query = buildSearchQuery(text, movieFacets, selectedFacets, skip, top);
    if (group) {
        const groupedField = movieFacetsToFieldName[group];
        return groupedSearch(movieSearchIndex, query, groupedField, group, groupTop, movieFacets)
        .then(results => ({
            groups: results.groups.map(group => ({code: group.code, label: group.label, totalCount: group.totalCount, list: parseMovies(group.list)})),
            facets: results.facets,
            totalCount: results.totalCount
        }))
    } else {
        return movieSearchIndex.search(query)
        .then(treatSearchResults(sortFieldName, sortDesc, movieFacets))
        .then(results => ({
            list: parseMovies(results.list),
            facets: results.facets,
            totalCount: results.totalCount
        }))
    }
})

const flush = () => movieSearchIndex.flush();

const info = () => movieSearchIndex.tellMeAboutMySearchIndex();

module.exports = {
    init,
    search,
    checkIsIndexEmpty: checkIsMovieIndexEmpty,
    populate,
    flush,
    info,
    snapShot,
    replicate
}
