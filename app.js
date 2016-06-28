var express = require('express');
var path = require('path');

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

// Start Server

app.listen(process.env.PORT || '3000', function () {
  console.log('Server started on port: ' + this.address().port);
});

// Libraries

var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();

var multer = require('multer');
var upload = multer( { dest: 'uploads/' } );
var shortid = require('shortid');

var fs = require('fs');
var _ = require('underscore');

var AWS = require('aws-sdk');
AWS.config.loadFromPath('./config.json').aws;
var s3 = new AWS.S3();
var docClient = new AWS.DynamoDB.DocumentClient();

var Cookies = require('cookies');
var jwt = require('jsonwebtoken');
var secret = "lololol";

var LineByLineReader = require('line-by-line');
var Parser = require("simple-text-parser");
var parser = new Parser();

// Public router functions

app.get('/', function (req, res) {
  res.render('index', { title: "LOL" });
});

app.get('/article/:category/:title', function (req, res) {
  var category = req.params.category;
  var title = req.params.title;
  var params = articleGetParams(category, title);
  docClient.get(params, function(err, data) {
    if (err) { res.json(err); } 
    else {
      var article = data.Item;
      var id = article.id;
      article.headerImg = "https://s3.amazonaws.com/clarionimgs/" + id + "-" + article.headerImg;
      var params = { Bucket: 'clarionarticles', Key: id };
      s3.getObject(params, function(err, data) {
        if (err) { 
          console.log(err, err.stack);
          res.send("ERROR, could not find text resource");
        }
        else {
          var buffer = new Buffer(data.Body);
          var body = buffer.toString('utf-8');
          article.content = parseContent(id, body);

          res.render('article', {
            article: article,
            urlBase: "localhost:3000"
          });
        }
      });
    }
  });
});

app.get('/category/:category', function (req, res) {
  var category = req.params.category;
  var params = categoryGetParams(category);
  docClient.query(params, function(err, data) {
    if (err) { res.json(err); } 
    else { 
      res.render('articles_list', {
        articles: data.Items,
        category: category,
        urlBase: "localhost:3000"
      });
    }
  });
});

// Editor Router Functions

app.use('/editor', function(req, res, next) {
  if (req.originalUrl == '/editor/login') { next(); }
  else {
    var cookies = new Cookies(req, res);
    var token = cookies.get('token');
    if (authorized(token)) next();
    else res.send('NOT AUTHORIZED');
  }
});

app.get('/editor/login', function (req,res,next) {
  var cookies = new Cookies(req, res);
  var token = cookies.get('token');
  if (authorized(token)) res.send('Logged In');
  else res.render('login', {});
});

app.post('/editor/login', multipartMiddleware, function( req, res, next ) {
  var user = req.body;
  var approved = require('./approved.json').approved;
  var cookies = new Cookies(req, res);
  var found = _.find(approved, function (u) { 
    return u.name == user.name && u.pass == user.pass; 
  });
  if (found) {
    var token = jwt.sign({ name: user.name, pass: user.pass }, secret);
    cookies.set('token', token);
    res.status(200).send("Logged In");
  } else {
    res.status(200).send("You are not an approved editor");
  }
});

app.get('/editor/logout', function( req, res, next ) {
  var cookies = new Cookies(req, res);
  cookies.set('token');
  res.redirect('/editor/login');
});

app.get('/editor/newArticle', function (req, res) {
  var id = shortid.generate();
  res.render('add_article', { 
    article: { 
      id: id,  title: '',  author: '', category: '', datePublished: '', headerImg: '', content: ''
    }
  });
});

app.post('/editor/newArticle/:id', multipartMiddleware, function (req, res) {
  var article = req.body.article;
  var id = req.params.id;
  var empty = noNullVals(article);
  if (empty.length == 0) {
    var html = parseContent(id, article.content);
    s3TxtUpload(id, article.content, html, function(done) {
      if (done) {
        delete article.content;
        var params = articlePutParams(id, article);
        docClient.put(params, function(err, data) {
          if (err) { res.send("ERROR, couldn't save article to Database."); }
          else { res.redirect('/article/' + linkify(article.category) + '/' + linkify(article.title)); }
        });
      } else { res.send("ERROR, couldn't save article body."); }
    });
  } else { res.send("ERROR, empty values for the article."); }
});

app.post('/editor/upload/:id', upload.single('file'), function( req, res, next ) {
  var id = req.params.id;
  var name = req.file.originalname;
  var path = req.file.path;
  if (req.file.mimetype.indexOf("image/") > -1) {
    s3ImgUpload(name, path, id, deleteFile);
  }
  res.status( 200 ).send("ALL GOOD DAWG");
});

app.get('/editor/editArticle/:category/:title', function (req, res) {
  var category = req.params.category;
  var title = req.params.title;
  var params = articleGetParams(category, title);
  docClient.get(params, function(err, data) {
    if (err) { res.json(err); } 
    else {
      var article = data.Item;
      var params = { Bucket: 'clarionarticles', Key: article.id };
      s3.getObject(params, function(err, data) {
        if (err) { 
          console.log(err, err.stack);
          res.send("ERROR, could not find content");
        }
        else {
          var buffer = new Buffer(data.Body);
          var body = buffer.toString('utf-8');
          article.content = body;

          res.render('add_article', {
            article: article,
            urlBase: "localhost:3000"
          });
        }
      });
    }
  });
});

app.get('/editor/directory', function (req, res) {
  docClient.scan({ TableName: "articleTable" }, function(err, data) {
    if (err) { res.json(err); } 
    else {
      res.render('directory', { 
        urlBase: "http://localhost:3000",
        articles: data.Items
      });
    }
  });
});

// DB params

var articlePutParams = function(id, article) {
 return {
   TableName: 'articleTable',
   Item: {
     id: id,
     title: article.title,
     author: article.author,
     category: article.category,
     datePublished: article.date,
     headerImg: article.headerImg,
     urlTitle: linkify(article.title),
     urlCategory: linkify(article.category),
     urlAuthor: linkify(article.author)
   }
 };
};

var articleGetParams = function(category, title) {
  return {
    TableName: 'articleTable',
    Key:{
      "urlCategory": category,
      "urlTitle": title
    }
  };
};
var categoryGetParams = function(category) {
  return {
    TableName: 'articleTable',
    KeyConditionExpression: "#cat = :category",
    ExpressionAttributeNames:{
      "#cat": "urlCategory"
    },
    ExpressionAttributeValues: {
      ":category": category
    }
  };
};

// S3 Functions

function s3ImgUpload(name, path, id, callback) {
  var imagePath = path;
  var imageName = id + "-" + name;
  var img = fs.readFileSync(imagePath);
  var params = {
    Bucket: 'clarionimgs', 
    Key: imageName, 
    Body: img,
    ContentType: img.mimetype,
    ACL: 'public-read'
  };
  s3.upload(params, function(err, data) {
    if (err) { 
      console.log(err);
      callback(false, path);
    }
    else { callback(true, path); }
  });
}

function s3TxtUpload(id, content, callback) {
  var params = {
    Bucket: 'clarionarticles', 
    Key: id, 
    Body: content,
    ContentType: 'text/plain',
    ACL: 'public-read'
  };
  s3.upload(params, function(err, data) {
    if (err) {
      console.log(err);
      callback(false);
    }
    else { callback(true); }
  });
}

// Helper Functions

function deleteFile(yes, path) {
  if (yes) {
    fs.unlink(path, function(err) {
      if (err) console.log(err);
    });  
  }
}

function noNullVals(obj) {
  var empty = [];
  if (_.isEmpty(obj))
    empty.push(null);
  for (var key in obj) {
    if (obj[key] == null || obj[key] == "")
      empty.push(key);
  }
  return empty;
}

function extractData(obj) {
  var article = {};
  for (var key in obj) {
    article[key] = obj[key].S;
  }
  return article;
}

function linkify(str) {
  return str.trim().replace(/\s+/g, '-').toLowerCase();
}

function authorized(token) {
  try {
    var user = jwt.verify(token, secret);
    var approved = require('./approved.json').approved;
    var found = _.find(approved, function (u) { 
      return u.name == user.name && u.pass == user.pass; 
    });
    if (found) return true;
    else return false;
  } catch(err) {
    return false;
  }
}

// Parser

parser.addRule(/\[(.*?)\]/, function(tag) {
  var src = "https://s3.amazonaws.com/clarionimgs/" + tag.replace(/[[\]]/g,'');
  return "<br><img class='img-responsive' src='" + src + "'><br>";
});
parser.addRule(/\{(.*?)\}/, function(tag) {
  return "<h2>" + tag.replace(/[{}]/g,'').trim() + "</h2>";
});
function parseContent(id, content) {
  // takes [ imagename.type  ] and turns it into [id-imagename.type]
  var text = content.trim().replace(/\[\s*(.*?)\s*]/g, '[$1]').replace(/\[/g,"[" + id + "-");
  var html = parser.render(text);
  return html;
}

// Finishing code

app.use(function(err, req, res, next) {
  console.log(err);
  res.status(err.status || 500);
  res.send("ERROR");
});

module.exports = app;



// there will be a preset list of approved editors in the form of a json file.
// table for 5 most recent from each category?
// or have another table with key = urlAuthor and sort = urlTitle, then 3rd attribute = category
// then I can simple query against this to get title and category, then i can get the rest, or simply maintain two tables
  // unused images are NOT deleted
  // text resource is overwritten
      // redirect to an error page or send error back to client
          // in callback, add type (error or not error)
          // TODO, limit to 10 order of closest date

          /* Parser

  - image: [imagename.type]
  - header: { header }

  */


/*
function generateSampleData() {
  var authors = [ 'Shivam Agrawal', 'Dhruv Agrawal' ];
  var categories = [ 'news', 'opinions', 'comedy' ];
  var dateRange = [ 42536, 42546 ];
  var Items = [];
  for (var i = 0; i < 100; i++) {
    var rand1 = Math.floor(Math.random() * (authors.length));
    var rand2 = Math.floor(Math.random() * (categories.length));
    var rand3 = Math.floor((Math.random() * (dateRange[1] - dateRange[0])) + dateRange[0]);
    //console.log(rand1 + "," + rand2 + "," + rand3);
    var author = authors[rand1];
    var category = categories[rand2];
    var datePublished = rand3 + "";
    var title = "Title " + i;
    Items.push({
      "urlCategory": { "S": category.replace(/\s+/g, '-').toLowerCase() },
      "urlTitle": { "S": title.replace(/\s+/g, '-').toLowerCase() },
      "urlAuthor": { "S": author.replace(/\s+/g, '-').toLowerCase() },
      "category": { "S": category },
      "title": { "S": title },
      "datePublished": { "N": datePublished },
      "author": { "S": author }
    });
  }
  loadSampleData(Items);
  //console.log(Items);
}

function loadSampleData(Items) {
  Items.forEach(function(Item) {
    var params = {
      TableName: "articleTable",
      Item: Item
    };
    db.putItem(params, function(err, data) {
     if (err) { console.log(err); }
     else { console.log("Item putted"); }
   });
  });
}
//generateSampleData();


// check back on this!
app.get('/author/:author', function (req, res) {
  var author = req.params.author;
  var params = categoryGetParams(author);
  docClient.query(params, function(err, data) {
    if (err) { res.json(err); } 
    else { res.json(data); }
  });
});

var authorGetParams = function(author) {
  return {
    TableName: 'articleTable',
    IndexName: 'urlAuthorIndex',
    KeyConditionExpression: "#auth = :author",
    ExpressionAttributeNames:{
      "#auth": "urlAuthor"
    },
    ExpressionAttributeValues: {
      ":author": author
    }
  };
};
*/
