(function(){
    'use strict';

    var express = require('express');
    var http = require('http');
    var moment = require('moment');
    var redis = require('redis');
    var url = require('url');
    var expressValidator = require('express-validator');

    var genericErrorMsg = "bummer, an error occured";
    var _ = require('underscore');
    

    // setup redis
    var parsedUrl = url.parse(process.env.REDISTOGO_URL || 'tcp://127.0.0.1:6379');
    var client = redis.createClient(parsedUrl.port, parsedUrl.hostname);
    if(parsedUrl.auth) {
        client.auth(parsedUrl.auth.split(":")[1], function(err) {
            console.log(err);
        });
    }
    client.on("error", function (err) {
        console.log("Error " + err);
    });


    var app = express();
    app.configure(function() {
        app.set('port', process.env.PORT || 3000);

        app.set('views', __dirname + '/views');   // nomrally __dirname + '/views");
        app.set('view engine', 'jade');

        app.use(express.favicon());
        app.use(express.logger('dev'));
        app.use(express.compress());
        app.use(express.bodyParser());      // json, urlencode and multipart forms

        var options = {};
        app.use(expressValidator(options));

        app.use(express.methodOverride());

        app.use(require('stylus').middleware(__dirname + '/static'));
        app.use(express.static(__dirname + '/static'));

        app.use(app.router);

        app.use(myErrorHandler);
    });

    app.configure('development', function() {
        app.locals.pretty = true;           // jade will render nice HTML
   });

    app.configure('production', function() {
        console.log('in production mode');
        app.use(express.errorHandler());
    });

    // app.locals is new in Express 3. Pre-initialize errors and message for use later.
    app.locals.errors = {};
    app.locals.message = {};

    // ROUTES
    //
    app.get('/', function(req, res) {
        res.render('index', {
            text: moment().format('dddd h:mm:ss a')
        });
    });

    var Alert = { success: 'success', info: 'info', warning: 'warning', error: 'error' };

    function alertbox(res, a, m, e)
    {
        var e = e || [];
        res.locals.alerts = {
            style: a,           // pick one from Alert
            msg: m,
            errors: e
        };
    }

    app.post('/', function(req, res) {
        req.checkBody('fullname', 'Name is required').notEmpty();
        req.checkBody('email', 'A valid email is required').isEmail();
        req.checkBody('code', 'An RSVP code is required').notEmpty();

        var errors = req.validationErrors();

        var fullname = res.locals.fullname = req.body.fullname;
        var email = res.locals.email = req.body.email;
        var code = res.locals.code = (req.body.code || '').toLowerCase();
        
        // two keys:
        // 'codes' holds the available tickets like 'rds' or 'mvps'
        // 'rsvp'  holds the people that have RSVPd

        if (errors) {
            var e = errors.map(function(n) { return n.msg; });
            alertbox(res, Alert.error, 'Please correct the following:', e);
            return res.render('index');
        }
        
        var renderMsg = function(alertType, msg){
            alertbox(res, alertType, msg);
            res.render('index');
        }

        var reallyBadError = function(){
            renderMsg(Alert.error, "Something not so pleasant just happened. :(");
        }

        // check if user already rsvp'd
        client.hexists('rsvp', email, function(err, alreadyRegistered) {
            if(err) {
                console.log(err);
                return renderMsg(Alert.error, genericErrorMsg);
            }

            if(alreadyRegistered) {
                return renderMsg(Alert.info, 'You\'ve already registered, Silly.');
            }

            // check if the specific rsvp code exists
            client.hexists('codes', code, function(err, codeIsGood) {
                if(err) {
                    console.log(err);
                    return renderMsg(Alert.error, genericErrorMsg);
                }

                if(!codeIsGood) {
                    return renderMsg(Alert.error, 'That RSVP code is not valid.');
                }

                // decrement the supplied code
                client.hincrby('codes', code, -1, function(err, result) {
                    if(err) {
                        console.log(err);
                        return renderMsg(Alert.error, genericErrorMsg);
                    }

                    if(result < 0) {
                        return renderMsg(Alert.warning, 'That RSVP code is no longer valid.');
                    }

                    // successfully decremented and we have a valid partier
                    // save the registered partier's name

                    var myData = fullname + '[' + code + ']';

                    client.hset('rsvp', email, myData, function(err){
                        if(err) {
                            console.log(err);
                            return renderMsg(Alert.error, genericErrorMsg);
                        }

                        return renderMsg(Alert.success, ' Thank you for RSVPing. See you on June 26th!');
                    });
                });
            });
        });
    });

    var count = 0;
    app.get('/hash/:key', function(req, res) {
        var key = req.params.key;       // skipping validity checks
        client.hgetall(key, function(err, hash) {
            res.send(hash);
        });
    });

    app.get('/partypeople', function(req, res) {
        client.hgetall('rsvp', function(err, hash) {
            var str = JSON.stringify(hash, null, true);
            console.log(str); 
            var xx = str.replace(/\[\w*\]/g, '');
            var xx = xx.replace(/,/g, '\n');
            res.send(xx);
        });
    });

    app.get('/partypeople/:password', function(req, res) {
        var pw = process.env.PARTYPEOPLE || 'local';
        if (req.params.password != pw)
        {
            res.redirect('/');
        }

        client.hgetall('rsvp', function(err, hash) {
            var pattern = /(.*)\[(\w*)\]/i;
            var rsvpTotal = 0;

            var x = _.map(hash, function(v, k) {
                rsvpTotal = rsvpTotal + 1;
                var match = pattern.exec(v);
                var person = {
                    code: match[2],
                    email: k,
                    name: match[1]
                };
                return person;
            });
            var y = _.groupBy(x, function(i) { return i.code.toUpperCase(); });
            // var y = _.countBy(x, function(i) { return i.code.toUpperCase(); });
            //
            //

            for (var code in y) {
                console.log(code);
                for (var i =0; i < y[code].length; i++)
                {
                    console.log(y[code][i].name);
                }
            }


            res.render("partypeople", {
                groups: y,
                rsvpTotal: rsvpTotal
            });
        });
    });

    app.get('/rsvps/:code', function(req, res){

        client.hgetall('rsvp', function(err, value) {
            var result = [];
            var code = req.params.code;
            var match = "[" + code + "]";

            for(var key in value) {
                var val = value[key];
                if((value[key] || "").indexOf(match) >= 0) {
                    result.push({
                        name: val.replace(match, ""), // trim the [code]
                        email: key
                    });
                }
            }

            // sort by name
            result = result.sort(function(a,b){
                return a.name > b.name;
            });

            client.hget("codes", code, function(err, value) {
                res.render("rsvps", {
                    rsvps: result,
                    code: (code||"").toUpperCase(),
                    invitesLeft: value || 0
                });
            });

       });
    
    });

    app.get('/error', function(req, res) {
        res.render('500', { error: req });
    });

    // since this is the last non-error-handling middle use()'d,
    // we assume it's a 404, as nothing else repsonded

    app.get('*', function(req, res) {
        res.status(404).end('Page not found.');
    });

    // ERROR HANDLING
    //
    function myErrorHandler(err, req, res, next) {
        console.error(err.stack);
        res.status(500).render('500', { error: err });
    }

    // LAUNCH THE SERVER
    // 
    http.createServer(app).listen(app.get('port'), function(){
        console.log('Express server listening on port ' + app.get('port'));
    });

})();
