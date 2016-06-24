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

var txtStorage = 'clarionarticles';
var imgStorage = 'clarionimgs';
var articlesTable = 'articlesTable';
var articlesIndex = 'urlTitle-index';

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

router.get('/article/:title', function (req, res) {
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
          console.log(data);
          var title = data.Item.title.S;
          var author = data.Item.author.S;
          var category = data.Items[0].title.S;

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
                title: title,
                author: author,
                body: body
              });
            }
          });
        }
      });
    }
  });
});

router.get('/newArticle', function (req, res) {
  var id = shortid.generate();
  res.render('add_article', { id: id });
});

// DB functions -------------------------------------------
var dbPutParams = function(id, article) {
  return {
    Item: {
      id: { S: id },
      title: { S: article.title },
      author: { S: article.author },
      category: { S: article.category },
      urlTitle: { S: article.title.replace(/\s+/g, '-').toLowerCase() }
    },
    TableName: articlesTable
  };
};
var dbGetParams = function(id) {
  return {
    TableName : articlesTable,
    Key : { id : { S : id } }
  };
};
var dbQueryParams = function(title) {
  return {
    TableName: articlesTable,
    IndexName: articlesIndex,
    AttributesToGet: [ 'id' ],
    KeyConditions: {
      urlTitle: {
        ComparisonOperator: 'EQ',
        AttributeValueList: [ { S: title } ]
      }
    }
  };
}
function putArticle(id, article) {
  var params = dbPutParams(id, article);
  db.putItem(params, function(err, data) {
    if (err) { console.log(err); }
    else {}
  });
}
function getArticle(id, callback) {
  var params = dbGetParams(id);
  db.getItem(params, function(err, data) {
    if (err) { console.log(err); } 
    else { callback(data); }
  });
}
function queryArticle(title, callback) {
  var params = dbQueryParams(title);
  db.query(params, function(err, data) {
    if (err) { console.log(err); } 
    else { callback(data); }
  });
}
// DB functions -------------------------------------------


// S3 functions -------------------------------------------
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

function s3TxtUpload(id, path, data, callback) {
  fs.writeFileSync(path, data);
  var txt = fs.readFileSync(path);
  var params = {
    Bucket: txtStorage, 
    Key: id, 
    Body: txt,
    ContentType: txt.mimetype,
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
// Helper functions -------------------------------------------


// Router functions -------------------------------------------
router.post('/newArticle/:id', multipartMiddleware, function (req, res) {
  var article = req.body.article;
  console.log(article);
  var id = req.params.id;
  var empty = noNullVals(article);
  if (empty.length == 0) {
    putArticle(id, article);
  }
  res.render('index', { title: "LOL" });
});

router.post( '/upload/:id', upload.single('file'), function( req, res, next ) {
  var id = req.params.id;
  var name = req.file.originalname;
  var path = req.file.path;
  if (req.file.mimetype == "text/plain") {
    parseDoc(req.file.path, id, function(data) {
      s3TxtUpload(id, path, data, deleteFile);
    });
  } else if (req.file.mimetype.indexOf("image/") > -1) {
    s3ImgUpload(name, path, id, deleteFile);
  }
  res.status( 200 ).send("ALL GOOD DAWG");
});


// Parsing functions -------------------------------------------

var LineByLineReader = require('line-by-line');
var Parser = require("simple-text-parser");
var parser = new Parser();

parser.addRule(/\[(.*?)\]/, function(tag) {
  var src = "https://s3.amazonaws.com/clarionimgs/" + tag.replace(/[[\]]/g,'');
  return "</span><img class='img' src='" + src + "'><span class='txt'>";
});
parser.addRule(/\<b(.*?)\b>/, function(tag) {
  return "<b>" + tag.replace(/<b|b>/g,'').trim() + "</b>";
});
parser.addRule(/\<i(.*?)\i>/, function(tag) {
  return "<i>" + tag.replace(/<i|i>/g,'').trim() + "</i>";
});
parser.addRule(/\<u(.*?)\u>/, function(tag) {
  return "<u>" + tag.replace(/<u|u>/g,'').trim() + "</u>";
});
parser.addRule(/\{(.*)}/, function(tag) {
  var linkInfo = tag.replace(/[{}]/g, "").split(",");
  return "<a href='" + linkInfo[1].trim() + "' target='_blank'>" + linkInfo[0].trim() + "</a>";
});

// possibly add new rule for paragraphs???

function parseDoc(fileLoc, id, callback) {
  var lr = new LineByLineReader(fileLoc);
  var html = "<span class='txt'>";
  lr.on('line', function (line) {
    if (line == "")
      html += "<br>";
    else
      var withId = line.trim().replace(/\[/g,"[" + id + "-");
    html += parser.render(withId);
  });
  lr.on('end', function () {
    html += "</span>"
    callback(html);
  });
}

// Parsing functions -------------------------------------------

/* Parser:

  image: [image.type]
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



app.use(function(err, req, res, next) {
  console.log(err);
  res.status(err.status || 500);
  res.send("ERROR");
});


module.exports = app;
