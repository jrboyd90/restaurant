var express = require('express');
var app = express();
//import body_parser
const body_parser = require('body-parser');
//import pg-promise
var pgp = require('pg-promise')({});
    // setup db
var db = pgp(process.env.DATABASE_URL || {database: 'restaurant'});

var session = require('express-session');
//used for hashing PW
var pbkdf2 = require('pbkdf2');
var crypto = require('crypto');


app.use(body_parser.urlencoded({extended: false}));
// sets up handlbars
app.set('view engine', 'hbs');
app.use('/static', express.static('public'));

//set up session
app.use(session({
  secret: process.env.SECRET_KEY || 'dev',
  resave: true,
  saveUninitialized: false,
  cookie: {maxAge: 60000}
}));
//more session middleware
app.use(function (req, resp, next) {
  if (req.session.user) {

    next();
  } else if (req.path.startsWith('/addReview')) {
    console.log(req.originalUrl);
    req.session.returnTo = req.originalUrl;
    resp.redirect('/login');
  } else {
    // req.session.returnTo = req.path;
    // console.log(req.session.returnTo);
    next();
  }
});


//renders home page
app.get('/', function (req, resp) {
  var context = {
    title: 'Restaurant Reviews',
    name: req.session.name
  }
  resp.render('index.hbs',context);
});

//renders search results
app.get('/search', function (req, resp, next) {
  var searchTerm = req.query.searchTerm;
  var q = "SELECT * from restaurant \
  WHERE name ILIKE '%$1#%'"
  db.any(q, searchTerm)
    .then(function(results) {
      resp.render('search_results.hbs', {
        title:'Search Results',
        name:req.session.name,
        results: results
      });
      // console.log(results);
    })
    .catch(next);
});


app.get('/addReview', function(req, resp) {
  var id = req.query.id;
  resp.render('addReview.hbs', {title: 'Add Review', id: id, name:req.session.name});
});

app.post('/addReview', function(req, resp, next) {
  var id = req.body.id;
  var stars = parseInt(req.body.stars);
  var title = req.body.title;
  var review = req.body.review;
  var columns = {
    stars: stars,
    title: title,
    review: review,
    restaurant_id: id,
    revId: req.session.rid
  }
  console.log(columns);
  var q = 'INSERT INTO review \
  VALUES (default, ${stars}, ${title}, ${review}, ${revId} , ${restaurant_id}) RETURNING id';
  db.any(q, columns)
    .then(function (results) {
      resp.redirect('/restaurant/' + id);
    })
  .catch(next);
});

app.get('/restaurant/new', function(req, resp){
  resp.render('addRestaurant.hbs', {title: 'Add a Restaurant', name:req.session.name});
});

app.post('/restaurant/submit_new', function(req, resp, next) {
  var name = req.body.name;
  var address = req.body.address;
  var category = req.body.category;
  var columns = {
    name: name,
    address: address,
    category: category,
  }
  var q = 'INSERT INTO restaurant \
  VALUES (default, ${name}, ${address}, ${category}) RETURNING id';
  db.one(q, columns)
    .then(function (results) {
      console.log(results.id);
      resp.redirect('/restaurant/' + results.id);
    })
  .catch(next);
});

app.get('/newUser', function(req,resp,next) {
  resp.render('newUser', {title: 'New Account'})
})

app.post('/newUser', function(req, resp, next) {
  var email = req.body.userName;
  var password = req.body.password;
  var rev_name = req.body.name;
  var salt = crypto.randomBytes(20).toString('hex');
  var key = pbkdf2.pbkdf2Sync(
    password, salt, 36000, 256, 'sha256'
  );
  var hash = key.toString('hex');
  var stored_pass = `pbkdf2_sha256$36000$${salt}$${hash}`;
  var columns = {
    email:email,
    password: stored_pass,
    rev_name: rev_name
  }
  var q = 'INSERT INTO reviewer \
  VALUES (default, ${rev_name}, ${email}, NULL, ${password}) RETURNING id';
  db.one(q,columns)
    .then(function (results) {
      console.log(results);
      req.session.user = email;
      req.session.name = rev_name;
      req.session.rid = results.id;
      resp.redirect('/');
    })
    .catch(function (error){
      resp.render('newUser.hbs', {err: 'Username already exists'});
    })
})

app.get('/login', function(req, resp, next) {
  resp.render('login.hbs',{ title: 'Login'});
});

app.post('/login', function(req, resp, next) {
  var email = req.body.userName;
  var password = req.body.password;
  var q = 'SELECT * from reviewer \
  WHERE email = $1';
  db.one(q,email)
    .then(function(results) {
      console.log(results.password);
      console.log(password);
      var pass = results.password
      var pass_parts = results.password.split('$');
      var key = pbkdf2.pbkdf2Sync(
        password,
        pass_parts[2],
        parseInt(pass_parts[1]),
        256, 'sha256'
      );
      var hash = key.toString('hex');
      if (hash === pass_parts[3]) {
        req.session.user = results.email;
        req.session.name = results.rev_name;
        req.session.rid = results.id;
        console.log(results.id);
        console.log(req.session.rid);

        resp.redirect(req.session.returnTo || '/');

      }
      else {
        resp.render('login.hbs',{ err: 'Incorrect Password' });
      }
    })
    .catch(function (error) {
      resp.render('login.hbs',{ err: 'Incorrect Login' });
    });
});

app.post('/logout', function (req,resp,next) {
    req.session.destroy(function(err) {
    // cannot access session here
    })

  resp.redirect('/login');
});

app.get('/restaurant/:id',function (req,resp,next) {
  var id = req.params.id;
  var q = 'SELECT restaurant.id, restaurant.name, restaurant.address, restaurant.category, \
  review.stars, review.title, review.review, reviewer.rev_name,reviewer.email, reviewer.karma from restaurant \
  LEFT JOIN review ON restaurant.id = review.restaurant_id \
  LEFT JOIN reviewer ON reviewer.id = review.reviewer_id \
  WHERE restaurant.id = $1';
  // console.log('My ID is ' +  id);
  db.any(q,id)
    .then(function (results) {
      // console.log(results);
      resp.render('restaurant.hbs', {title: 'Restaurant', results: results, name:req.session.name});
    })
    .catch(next);

});

//starts up server on port 8000
var PORT = process.env.PORT || 8888;
app.listen(PORT, function () {
  console.log('Listening on port ' + PORT);
});
