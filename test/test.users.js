/*jslint node: true, indent: 2, white: true, vars: true */
/*globals suite, test, setup, suiteSetup, suiteTeardown, beforeEach, done, teardown */
'use strict';

// Libraries
var assert = require('assert');
var mongo = require('mongodb');
var request = require('request');
var should = require('should');
var util = require('util');

// LocalData
var server = require('../web.js');
var settings = require('../settings-test.js');
var users = require('../users.js');

var BASEURL = 'http://localhost:' + settings.port + '/api';
var BASE_LOGOUT_URL = 'http://localhost:' + settings.port + '/logout';

suite('Users -', function () {
  var Matt = function() {
    return {
      name: "Matt Hampel",
      email: "example@example.com",
      randomThing: "security problem!",
      password: "abc123"
    };
  };

  suiteSetup(function (done) {
    server.run(settings, done);
  });

  suiteTeardown(function () {
    server.stop();
  });


  suite('finding, creating and editing without the API:', function () {
    

    test('create a user', function (done) {
      console.log(users.User.wipe());
      users.User.create(new Matt(), function(error, user){
        user.should.have.property('_id');
        user.should.not.have.property('randomThing');
        assert.equal(user.name, new Matt().name); 
        assert.equal(user.email, new Matt().email); 
        done();
      });
    });


    test('users must have an email', function (done) {     
      users.User.wipe();
      users.User.create({"name": "No Email", "password": "luggage"}, function(error, user){
        should.exist(error);
        error.code.should.equal(400);
        done();
      });
    });

    test('users must be created with a password', function (done) {     
      users.User.wipe();
      users.User.create({"name": "No Password", "email": "example@example.com"}, function(error, user){
        should.exist(error);
        error.code.should.equal(400);
        done();
      });
    });

    test('user emails must be unique', function (done) {
      users.User.wipe();
      users.User.create(new Matt(), function(error, userOne) {
        // console.log("First user ", userOne);
        users.User.create(new Matt(), function(error, userTwo){
          console.log("Second user ", userTwo);
          should.exist(error);
          done();
        });
      });
    });

    test('update a user name and email', function (done) {
      users.User.wipe();
      users.User.create(new Matt(), function(error, user) {
        var tempId = user._id;
        user.name = "Prashant";
        user.email = "prashant@codeforamerica.org";

        users.User.update(user, function(error, userEdited){
          // console.log(tempId);
          // console.log("saved user" , user);
          // console.log("saved user" , userEdited);

          assert.equal(String(tempId), String(user._id)); 
          assert.equal(user.name, "Prashant"); 
          assert.equal(user.email, "prashant@codeforamerica.org"); 
          done();
        });
      });

    });

  });

  suite('DEL', function () {

    setup(function (done) {
      done();
    });

    test('Deleting a user', function (done) {
      // test for stuff
      assert.equal(true, false); 
      done();
    });

  });

  suite('authentication API:', function () {
    var userUrl = BASEURL + '/user';
    var loginUrl = BASEURL + '/login';
    var logoutUrl = 

    suiteSetup(function (done) {
      done();
    });

    test('Create a user via API', function (done) {
      users.User.wipe();
      request.post({url: userUrl, json: new Matt()}, function (error, response, body) {      
        should.not.exist(error);
        response.statusCode.should.equal(302);

        request.get({url: userUrl}, function (error, response, body){
          should.not.exist(error);
          response.statusCode.should.equal(200);
          response.should.be.json;

          var parsed = JSON.parse(body);

          parsed.should.have.property("email", "example@example.com");
          parsed.should.have.property("name", "Matt Hampel");
          parsed.should.not.have.property("randomThing");
          parsed.should.not.have.property("password");
          parsed.should.not.have.property("hash");

          done();
        });
      });
    });

    test('Log in a user via the API', function (done) {

      // First, let's log out
      request.get({url: BASE_LOGOUT_URL}, function(error, response, body) {

        // Then, let's log in. 
        request.post({url: loginUrl, json: new Matt()}, function (error, response, body) {      
          should.not.exist(error);
          response.statusCode.should.equal(302);

          request.get({url: userUrl}, function (error, response, body){
            should.not.exist(error);
            response.statusCode.should.equal(200);
            response.should.be.json;

            var parsed = JSON.parse(body);

            parsed.should.have.property("email", "example@example.com");
            parsed.should.have.property("name", "Matt Hampel");
            parsed.should.not.have.property("randomThing");
            parsed.should.not.have.property("password");
            parsed.should.not.have.property("hash");

            done();
          });
        });

      });
    });

    test('Try to get details about the current user via API when not logged in', function (done) {
      users.User.wipe();
      // First, let's log out
      request.get({url: BASE_LOGOUT_URL}, function(error, response, body) {
        request.get({url: userUrl}, function(error, response, body) {
          response.statusCode.should.equal(401);
          done();
        });
      });
    });


  });
});
