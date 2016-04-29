var express  	= require('express');
var app     	= express();
var http 		= require('http');
var path 		= require('path');
var bodyParser 	= require('body-parser');
var oio			= require('orchestrate');
var q			= require('kew');


app.use("/js", express.static(__dirname + "/public/js"));
app.use("/css", express.static(__dirname + "/public/css"));
app.use("/bower_components", express.static(__dirname + "/public/bower_components"));

app.use(bodyParser.urlencoded({'extended':'true'}));
app.use(bodyParser.json());
app.use(bodyParser.json({ type: 'application/vnd.api+json' }));

app.post("/api/map/:collection", function(req, res) {
	var token = req.header('key');
	var collection = req.params.collection;
	var query = req.body.query;
	var mapFunction = req.body.mapFunction;

	if(req.query.preview) {
		preview(token, collection, query, mapFunction).then(function(response) {
			res.status(200).json(response);
		}).fail(function(err) {
			res.status(500).json({message: err});
		}).done();
	} else {
		update(token, collection, query, mapFunction).then(function(response) {
			res.status(200).json(response);
		}).fail(function(err) {
			res.status(500).json({message: err});
		}).done();
	}
});

app.all('/*', function(req, res) {
	res.sendFile('index.html', { root: path.join(__dirname, './public') });
});

var server = http.createServer(app).listen(process.env.PORT || 8085, function() {
	var host = server.address().address;
	host = host === '::' ? '[' + host + ']' : host;
	var port = server.address().port;
	console.log('orchestrate advanced client started. listening at http://%s:%s', host, port);
});

function update(token, collection, query, mapFunction) {
	
	var defer = q.defer();
	
	var db = oio(token, 'api.orchestrate.io');
	
    db.search(collection, query, {
        limit : 100,
        sort : 'value.id:asc',
    }).then(function(response) {
    	onResponse(db, collection, response, mapFunction, defer);
    }).fail(function(err) {
        defer.reject(err);
    }).done();
    
    return defer.promise;
}

function onResponse(db, collection, response, mapFunction, defer) {
	
	var updates = [];
    
	var f = new Function('id', 'value', mapFunction);
	response.body.results.forEach(function(result) {
		updated = f(result.path.key, result.value);
		updates.push(db.put(collection, result.path.key, updated));
	});
	
	q.all(updates)
	.then(function(res) {
		if(response.links && response.links.next) {
			response.links.next.get().then(function(nextResponse) {
				onResponse(db, collection, nextResponse, mapFunction, defer);
			}).fail(function(err) {
				defer.reject(err);
			});
		} else {
			defer.resolve({message: 'success !'});
		}
	}).fail(function(err) {
		defer.reject(err);
	}).done();
}

function preview(token, collection, query, mapFunction) {

	var defer = q.defer();
	
	var db = oio(token, 'api.orchestrate.io');
	
    db.search(collection, query, {
        limit : 100,
        sort : 'value.id:asc',
    }).then(function(response) {
    	
    	var total = response.body.total_count;
    	
    	var originalValues = response.body.results.map(function(result) {
    		return JSON.parse(JSON.stringify(result.value));
    	});
    	
    	var f = new Function('id', 'value', mapFunction);
    	var updatedValues = response.body.results.map(function(result) {
    		try {
				return f(result.path.key, result.value);
    		} catch(err) {
    			defer.reject(err);
    			throw err;
    		}
    	});
    	
    	var diffs = [];
    	for(var i = 0; i < originalValues.length; i++) {
    		diffs.push({before:originalValues[i], after:updatedValues[i]});
    	}

		defer.resolve({count:total, diffs:diffs});
    	
    }).fail(function(err) {
        defer.reject(err);
    }).done();
    
    return defer.promise;
}