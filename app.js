var express = require('express');
var path = require('path');
//var bodyParser = require('body-parser');

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
//app.use(bodyParser.json());
var router = express.Router();
app.use(router);
app.use(express.static(path.join(__dirname, 'public')));

app.listen(process.env.PORT || '3000', function () {
  console.log('Server started on port: ' + this.address().port);
});

router.get('/', function (req, res) {
  res.render('index', { title: "LOL" });
});

var articlesTable = 'articlesTable';


// Article add

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
var db = new AWS.DynamoDB();

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


// Router functions -------------------------------------------

// table for 5 most recent from each category?
// or have another table with key = urlAuthor and sort = urlTitle, then 3rd attribute = category
// then I can simple query against this to get title and category, then i can get the rest, or simply maintain two tables

var docClient = new AWS.DynamoDB.DocumentClient();

app.get('/article/:category/:title', function (req, res) {
  var category = req.params.category;
  var title = req.params.title;
  var params = articleGetParams(category, title);
  docClient.get(params, function(err, data) {
    if (err) { res.json(err); } 
    else {
      var article = data.Item;
      article.headerImg = "https://s3.amazonaws.com/clarionimgs/" + article.id + "-" + article.headerImg;
      var params = { Bucket: 'clarionarticles', Key: article.id };
      s3.getObject(params, function(err, data) {
        if (err) { 
          console.log(err, err.stack);
          res.send("ERROR, could not find text resource");
        }
        else {
          var buffer = new Buffer(data.Body);
          var body = buffer.toString('utf-8');

          res.render('article', {
            article: article,
            urlBase: "localhost:3000"
          });
        }
      });
    }
  });
});
var articleGetParams = function(category, title) {
  return {
    TableName: 'articleTable',
    Key:{
      "urlCategory": category,
      "urlTitle": title
    }
  };
};

// TODO, limit to 10 order of closest date
app.get('/category/:category', function (req, res) {
  var category = req.params.category;
  var params = categoryGetParams(category);
  docClient.query(params, function(err, data) {
    if (err) { res.json(err); } 
    else { 
      res.render('articles_list', {
        articles: data.Items,
        urlBase: "localhost:3000"
      });
    }
  });
});
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

// TODO, need to edit all of these to update them!

// Editor Functions

// there will be a preset list of approved editors in the form of a json file.
var Cookies = require('cookies');

app.use('/editor', function(req, res, next) {
  console.log('Request URL:', req.originalUrl);
  var cookies = new Cookies(req, res);
  var approved = require('./approved.json').approved;
  var user = { name: cookies.get('uname'), pass: cookies.get('upass') };
  var found = _.find(approved, function (u) { 
    return u.name == user.name && u.pass == user.pass; 
  });
  if (found) next();
  else res.send("NOT AUTHORIZED");
});

app.get('/editorlogin', function (req,res,next) {
  res.render('login', {}); // TODO, redirect if logged in
});

app.post('/editorlogin', multipartMiddleware, function( req, res, next ) {
  var user = req.body;
  var approved = require('./approved.json').approved;
  var cookies = new Cookies(req, res);
  var found = _.find(approved, function (u) { 
    return u.name == user.name && u.pass == user.pass; 
  });
  if (found) {
    cookies.set('uname', user.name);
    cookies.set('upass', user.pass);
    res.status(200).send("Logged In");
  } else {
    res.status(200).send("You are not an approved editor");
  }
});

app.get('/editor/logout', function( req, res, next ) {
  var cookies = new Cookies(req, res);
  cookies.set('uname');
  cookies.set('upass');
  res.render('login', {});
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
    s3TxtUpload(id, article.content, html);
    delete article.content;
    // in callback, add type (error or not error)
    articlePut(id, article, function(data) {
      res.redirect('/article/' + linkify(article.category) + '/' + linkify(article.title));
    });
  } else {
    res.send("ERROR");
    // redirect to an error page or send error back to client
  }
});

app.post('/editor/upload/:id', upload.single('file'), function( req, res, next ) {
  var id = req.params.id;
  console.log("FILE UPLOAD: " + id);
  var name = req.file.originalname;
  var path = req.file.path;
  if (req.file.mimetype.indexOf("image/") > -1) {
    s3ImgUpload(name, path, id, deleteFile);
  }
  res.status( 200 ).send("ALL GOOD DAWG");
});

app.get('/editor/editArticle/:category/:title', function (req, res) {
  // unused images are NOT deleted
  // text resource is overwritten
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
          article.content = JSON.parse(body).original;

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
}
function articlePut(id, article, callback) {
  var params = articlePutParams(id, article);
  docClient.put(params, function(err, data) {
    if (err) { console.log("ERROR: " + err); }
    else { callback(data); }
  });
}

// Router functions -------------------------------------------

/* AWS format

  DynamoDB - this is wrong!
  - 1 table titled 'articlesTable'
  - 3 global secondary indexes:
    - urlTitleIndex
    - urlCategoryIndex
    - urlAuthorIndex

  S3
  - 1 bucket titled 'clarionimgs'
  - 1 bucket titled 'clarionarticles'

  */

// S3 functions -------------------------------------------
var txtStorage = 'clarionarticles';
var imgStorage = 'clarionimgs';

function s3ImgUpload(name, path, id, callback) {
  var imagePath = path;
  var imageName = id + "-" + name;
  var img = fs.readFileSync(imagePath);
  var params = {
    Bucket: imgStorage, 
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

function s3TxtUpload(id, txtContent, htmlContent) {
  var content = JSON.stringify({
    original: txtContent,
    formatted: htmlContent
  });
  var params = {
    Bucket: 'clarionarticles', 
    Key: id, 
    Body: content,
    ContentType: 'text/plain',
    ACL: 'public-read'
  };
  s3.upload(params, function(err, data) {
    if (err) {  console.log(err); }
    else {  }
  });
}
// S3 functions -------------------------------------------


// Helper functions -------------------------------------------
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

// plus more cleaning?
function cleanString(str) {
  return str.trim();
}

function linkify(str) {
  return str.trim().replace(/\s+/g, '-').toLowerCase();
}
// Helper functions -------------------------------------------


// Parsing functions -------------------------------------------

var LineByLineReader = require('line-by-line');
var Parser = require("simple-text-parser");
var parser = new Parser();

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

/* Parser

  - image: [imagename.type]
  - hedaer: { header }

*/




// possibly add new rule for paragraphs???
// add <q q> for quote - no, don't


/*function parseDoc(fileLoc, id, callback) {
  var lr = new LineByLineReader(fileLoc);
  var html = "<span class='txt'>";
  lr.on('line', function (line) {
    if (line == "") { 
      html += "<br>";
    else {
      var withId = 
    html += parser.render(withId);
  });
  lr.on('end', function () {
    html += "</span>"
    callback(html);
  });
}*/

// Parsing functions -------------------------------------------

/* Parser:

  image: [image.type] !!! no spaces
  // accepts all image types. make sure if img is jpeg, type jpg in editor.
  bold: <b text in bold b>
  italics: <i text in italics i>
  underline: <u text in underline u>
  newline: \n

  Not included (yet):
  - no inline images
  - no tabs in articles
  - no captions for images

  TODO
  - add article categories (news, etc)
  - delete imgs from upload folder
  - make better content management system. i.e edit articles and delete cloud objects

  - navbar & other styles
  - search
  - make look cool
  */

// add recent articles query later

/*
var bRegex = "<b(.*)b>";
var iRegex = "<i(.*)i>";
var uRegex = "<u(.*)u>";

// var testRE = test.match("cow(.*)milk");

function boRegex(line) {
  var match = line.match(bRegex);
  if (match != null)
    return "<b>" + match[1].trim() + "</b>";
}
*/

// img width - max 100%, img height- max 50vh, make it a block, so it is a new line. and end paragraph there.
// make html wrap b/c its all going to be text.
// classes - img: .img, text: .txt

// here, i get article by title. This is the main way to go
  // maybe do some fancy stuff with the date and category, etc to make url look cool
  // make sure to plan this out first!!!
  // and when done, try to make it open source, but first show it to clarion peeps.
  // worst comes to worst, i'll use it for my own blog
  // open source this blog software b/c i essentially wrote my own language!!!


/*app.get('/article/:title', function (req, res) {
  var title = req.params.title;
  queryArticle(title, function(data) {
    if (_.isEmpty(data)) {
      res.send("ERROR, article not found, 404");
    } else {
      var id = data.Items[0].id.S;
      getArticle(id, function(data) {
        if (_.isEmpty(data)) {
          res.send("ERROR, invalid article id");
        } else {
          var article = extractData(data.Item);
          // get similar articles from category


          var params = { Bucket: txtStorage, Key: id };
          s3.getObject(params, function(err, data) {
            if (err) { 
              console.log(err, err.stack);
              res.send("ERROR, could not find text resource");
            }
            else {
              var buffer = new Buffer(data.Body);
              var body = buffer.toString('utf-8');

              res.render('article', {
                article: article,
                body: body,
                urlBase: "localhost:3000",
                header: {
                  img: "http://shivamhacks.github.io/imgs/opener-background.jpeg",
                  color: "#000000"
                }
              });
            }
          });
        }
      });
    }
  });
});
app.get('/category/:category', function (req, res) {
  var category = req.params.category;
  queryCategory(category, function(data) {
    if (_.isEmpty(data)) {
      res.send("ERROR, category not found, 404");
    } else {
      dbBatchGet(data.Items, function(data) {
        res.render('articles_list', {
          articles: data.Responses.articlesTable,
          title: category,
          urlBase: "localhost:3000"
        });
      });
    }
  });
});
app.get('/author/:author', function (req, res) {
  var author = req.params.author;
  queryAuthor(author, function(data) {
    if (_.isEmpty(data)) {
      res.send("ERROR, author not found, 404");
    } else {
      dbBatchGet(data.Items, function(data) {
        res.render('articles_list', {
          articles: data.Responses.articlesTable,
          title: author,
          urlBase: "localhost:3000"
        });
      });
    }
  });
});*/


app.use(function(err, req, res, next) {
  console.log(err);
  res.status(err.status || 500);
  res.send("ERROR");
});


module.exports = app;
