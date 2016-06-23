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

var ids = [];
//var articles = [];

var multipart = require('connect-multiparty');
var multipartMiddleware = multipart();

var multer = require('multer');
var upload = multer( { dest: 'uploads/' } );
var shortid = require('shortid');

var fs = require('fs');
var _ = require('underscore');

try {
  fs.mkdirSync('articles');
} catch(e) {
  if ( e.code != 'EEXIST' ) throw e;
}

router.get('/newArticle', function (req, res) {
  var id = shortid.generate();
  var fileName = './articles/' + id + '.json';
  fs.writeFile(fileName, JSON.stringify({ 
    id: id,
    imgs: []
  }), function(err) {
    if (err) console.log(err);
    else console.log("Created article json: " + id);
  });
  res.render('add_article', { id: id });
});

router.post('/newArticle/:id', multipartMiddleware, function (req, res) {
  var articleData = req.body.article;
  var id = req.params.id;
  if (articleData != null && articleData.title != "" && articleData.author != "") {
    var fileName = './articles/' + id + '.json';
    var file = require(fileName);
    file.title = articleData.title;
    file.author = articleData.author;
    fs.writeFile(fileName, JSON.stringify(file), function (err) {
      if (err) console.log(err);
      else console.log("Saved article data of: " + id);
    });
    // here, upload images to s3 and change img locations, and save article json to dynamodb.
  }
  res.render('index', { title: "LOL" });
});

router.post( '/upload/:id', upload.single('file'), function( req, res, next ) {
  var id = req.params.id;
  var name = req.file.originalname;
  var path = req.file.path;
  if (req.file.mimetype == "text/plain") {
    parseDoc(req.file.path, function(data) {
      var fileName = './articles/' + id + '.json';
      var file = require(fileName);
      file.html = data;
      fs.writeFile(fileName, JSON.stringify(file), function (err) {
        if (err) console.log(err);
        else console.log("Saved html of: " + id);
      });
    });
  } else if (req.file.mimetype.indexOf("image/") > -1) {
    var fileName = './articles/' + id + '.json';
    var file = require(fileName);
    file.imgs.push({
      name: name,
      path: path
    })
    fs.writeFile(fileName, JSON.stringify(file), function (err) {
      if (err) console.log(err);
      else console.log("Saved image of: " + id);
    });
  }
  res.status( 200 ).send("ALL GOOD DAWG");
});



// Parsing stuff


var LineByLineReader = require('line-by-line');
var Parser = require("simple-text-parser");
var parser = new Parser();

parser.addRule(/\[(.*?)\]/, function(tag) {
  return "</span><img class='img' src='" + tag.replace(/[[\]]/g,'') + "'><span class='txt'>";
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

function parseDoc(fileLoc, callback) {
  var lr = new LineByLineReader(fileLoc);
  var html = "<span class='txt'>";
  lr.on('line', function (line) {
    if (line == "")
      html += "<br>";
    else
      html += parser.render(line);
  });
  lr.on('end', function () {
    html += "</span>"
    callback(html);
    //console.log(html);
  });
  //console.log(html);
  //return html;
}

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



app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.send("ERROR");
});


module.exports = app;
