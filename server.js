const express = require('express')
const path = require('path')
const MFA = require('mangadex-full-api');
var bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const axios = require('axios');
const sizeOf = require('image-size')
const JSZip = require('jszip')
const Jimp = require('jimp')
var jp = require('jsonpath');

var urlencodedParser = bodyParser.urlencoded({ extended: false })

const app = express();
var server = require('http').createServer(app);
var io = require('socket.io')(server, {
  pingInterval: 10000, // 10 seconds
  pingTimeout: 5000, // 5 seconds
});

app.use(express.static(path.join(__dirname, '/public')));
app.set('view engine', 'pug');
app.set('views', 'public')

if (!fs.existsSync("settings.cfg")) {
  dir = __dirname;
  dir2 = String.raw`\Downloaded`
  fs.writeFileSync("settings.cfg", "PDF\nLow\n"+dir+dir2)
}

app.get('/', async function (req, res) {
  try{
    random = await MFA.Manga.getRandom(["safe"], false)
    while (random.localizedDescription.en == undefined || random.localizedDescription.en == '') {
      random = await MFA.Manga.getRandom(["safe", "suggestive"], false)
    }
    id = 'https://mangadex.org/title/' + random.id;
    cover = await MFA.Cover.get(random.mainCover.id);
    cover = cover.imageSource;
    cover = await fetchImage(cover);
    cover = 'data:image/png;base64,' + Buffer.from(cover).toString('base64')
    title = random.localizedTitle.en
    desc = random.localizedDescription.en
    author = await MFA.Author.get(random.authors[0].id)
    author = author.name
    random = JSON.stringify(random.tags)
    tags = getTags(random)
    data = [title, cover, desc, author, tags, id]
    res.render('search.pug', { id: [], cover: [], title: [], res: 0, random: data })
  }
  catch(e){
    res.render('error.pug', { type: 1 })
  }
})

function getSettings() {
  const data = fs.readFileSync('settings.cfg', 'utf8');
  const lines = data.split('\n');
  const format = lines[0];
  const quality = lines[1];
  const directory = lines[2];
  return [format, quality, directory]
}

app.get('/settings', function (req, res) {
  data = getSettings();
  res.render('settings.pug', { format: data[0], quality: data[1], directory: data[2] })
});

app.post('/saveSettings', urlencodedParser, function (req, res) {
  format = req.body.setform
  quality = req.body.setqual
  dir = req.body.setdir
  file = format + "\n" + quality + "\n" + dir
  fs.writeFile('settings.cfg', file, (error) => {
    if (error) {
      // Handle the error
      console.error('Error writing file:', error);
    } else {
      // File was written successfully
      console.log('File written successfully.');
    }
  });

  res.redirect('/settings')
})


async function compressImage(pages, qlty) {
  const image = await Jimp.read(pages);
  if (qlty < 100) {
    image.quality(qlty);
  }
  const compressedBuffer = await image.getBufferAsync(Jimp.MIME_JPEG);
  return compressedBuffer;
};

async function fetchImage(pages) {
  try {
    const response = await axios.get(pages, {
      responseType: 'arraybuffer',
      maxContentLength: 100000000,
        maxBodyLength: 1000000000
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching image:', error);
    throw error; // Rethrow the error to be handled at the higher level
  }
}

const fetchImageBatch = async (urls) => {
  const imagePromises = urls.map(async (url) => {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return response.data;
    } catch (error) {
      // Handle errors for individual requests
      return null;
    }
  });

  return await Promise.all(imagePromises);
};

const fetchAllImages = async (urls, batchSize) => {
  const imageBuffers = [];

  for (let i = 0; i < urls.length; i += batchSize) {
    const batchUrls = urls.slice(i, i + batchSize);
    const batchBuffers = await fetchImageBatch(batchUrls);
    imageBuffers.push(...batchBuffers);
  }

  return imageBuffers;
};

function getChapters(chapter) {
  var array = []
  JSON.parse(chapter, function (key, value) {
    if (key == 'chapter') {
      if (value == "none") {
        array = array.concat("Oneshot")
      }
      else {
        array = array.concat(value)
      }
    }
  })
  return array;
}

function getTags(tags) {
  var array = []
  JSON.parse(tags, function (key, value) {
    if (key == 'en') {
      array = array.concat(value)
    }
  })
  return array.toString().replace(/,/g, ', ')
}

function getDownloads(chaps, title) {
  const data = fs.readFileSync('settings.cfg', 'utf8');
  const lines = data.split('\n');
  const directory = lines[2] + '/' + title;
  dled = []
  for (i = 0; i < chaps.length; i++) {
    if (fs.existsSync(directory + '/chapter_' + chaps[i] + '.pdf') && !fs.existsSync(directory + '/chapter_' + chaps[i] + '.cbz')) {
      dled.push(1)
    }
    else if (!fs.existsSync(directory + '/chapter_' + chaps[i] + '.pdf') && fs.existsSync(directory + '/chapter_' + chaps[i] + '.cbz')) {
      dled.push(2)
    }
    else if (fs.existsSync(directory + '/chapter_' + chaps[i] + '.pdf') && fs.existsSync(directory + '/chapter_' + chaps[i] + '.cbz')) {
      dled.push(3)
    }
    else {
      dled.push(0)
    }
  }
  return dled
}

function getBoth(chapter) {
  var dic = {}
  for (i in chapter) {
    for (j in chapter[i].chapters) {
      n = chapter[i].chapters
      if (n[j].chapter == "none") {
        dic["Oneshot"] = n[j].id
      }
      else {
        dic[n[j].chapter] = n[j].id
      }
    }
  }
  return dic;
}

async function raw(dir, chapterList, chapterSets, qlty){
  done = 0;
  io.emit('status', 'Evaluating resources to be downloaded...');
    chapters = []
    for (chapterIdx = 0; chapterIdx < chapterList.length; chapterIdx++) {
      console.log(chapterSets[chapterList[chapterIdx]])
      let chapter = await MFA.Chapter.get(chapterSets[chapterList[chapterIdx]])
      chapters.push(chapter);
    }

    io.emit('status', 'Retrieving chapters...');
    for (chapterIdx = 0; chapterIdx < chapters.length; chapterIdx++) {
      if (fs.existsSync(dir+'/chapter_'+chapterList[chapterIdx]) == false ){
      let chapter = chapters[chapterIdx]
      try {
        pages = await chapter.getReadablePages()
      }
      catch {
        try {
          let aggr = await MFA.Manga.getAggregate(url[4], 'en');
          var chaps = jp.query(aggr, '$..' + chapters[chapterIdx]);
          chapter = chaps[0].others[0]
          chapter = await MFA.Chapter.get(chapter)
          console.log(chapter)
          pages = await chapter.getReadablePages()
        }
        catch {
          continue
        }
      }
      io.emit('status', 'Preparing Chapter ' + chapterList[chapterIdx] + "...");
      //const buffers = await Promise.all(pages.map(fetchImage));

      io.emit('status', 'Downloading Raw Images...');
      for (i = 0; i < pages.length; i++) {
        saveTo = dir + '/chapter_' + chapterList[chapterIdx]
        if (!fs.existsSync(saveTo)) {
          fs.mkdirSync(saveTo, { recursive: true });
        }
        j = i + 1
        buffer = await fetchImage(pages[i])
        fs.writeFileSync(dir + '/chapter_' + chapterList[chapterIdx] + '/' + j + '.jpg', Buffer.from(buffer));
        io.emit('prog', [done, chapterList.length]);
        if (done == chapterList.length) {
          io.emit('end')
        }
      }
      done += 1
    }
    else{
      io.emit('status', 'Raw images already exist');
    }
  }
}

app.get('/getManga', urlencodedParser, async function (req, res) {
  search = req.query.search
  try{
    let manga = await MFA.Manga.search(search);
    title = []
    id = []
    cover2 = []
    author = []
    for (i = 0; i < manga.length; i++) {
      t = manga[i].localizedTitle.en
      if (t!=undefined){
        title.push(t)
      }
      else{
        title.push("No title")
      }
      id.push('https://mangadex.org/title/' + manga[i].id + '/title')
      cover = await MFA.Cover.get(manga[i].mainCover.id);
      cover = cover.image256;
      cover = await fetchImage(cover);
      cover = Buffer.from(cover).toString('base64')
      cover2.push('data:image/png;base64,' + cover)
      try {
        authorName = await MFA.Author.get(manga[i].authors[0].id)
      }
      catch {
        authorName = ""
      }
      author.push(authorName.name)
    }
    res.render('search.pug', { id: id, cover: cover2, title: title, author: author, res: 1 })
  }catch(e){
    res.render('error.pug', { type: 1 })
  }
});

app.get('/getChapter', urlencodedParser, async function (req, res) {
  url = req.query.search
  id = url.split("/")
  try{
    let manga = await MFA.Manga.get(id[4]);
    let cover = await MFA.Cover.get(manga.mainCover.id);
    cover = cover.imageSource;
    cover = await fetchImage(cover);
    cover = Buffer.from(cover).toString('base64')

    authors = []
    for (i in manga.authors) {
      authorName = await MFA.Author.get(manga.authors[i].id)
      authors.push(authorName.name)
    }
    title = manga.localizedTitle.en
    desc = manga.localizedDescription.en

    let aggr = await MFA.Manga.getAggregate(id[4], 'en');
    let aggrP = JSON.stringify(aggr)
    chaps = getChapters(aggrP);
    dled = getDownloads(chaps, title);
    console.log(dled)
    set = getBoth(aggr);

    data = getSettings();

    res.render('index.pug', { dled: dled, chap: chaps, set: set, author: authors, title: title, desc: desc, cover: 'data:image/png;base64,' + cover, res: 1, format: data[0], quality: data[1], directory: data[2], url: url })
  } catch(e){
    res.render('error.pug', { type: 1 })
  }
});

app.use(function (req, res, next) {
  req.io = io;
  next();
});

let shouldStop = false;

app.post('/PDF', urlencodedParser, async function (req, res) {
  donepages = 0
  totpages = 0
  var io = req.io;
  chapterList = req.body.chaps.split(",")
  chapterSets = JSON.parse(req.body.sets)
  quality = req.body.quality
  format = req.body.format
  title = req.body.title
  directory = req.body.dir
  chaps = req.body.chap
  set = req.body.set
  search = req.body.url
  url = url.split("/")

  var dir = directory + '/' + title;
  dir = dir.replace('//', '/')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (quality == 'High') {
    qlty = 90;
  }
  else if (quality == "Medium") {
    qlty = 70;
  }
  else if (quality == "Low") {
    qlty = 50;
  }
  else {
    qlty = 100;
  }
  console.log(qlty)
  raw(dir, chapterList, chapterSets, qlty).then(async (result) => {
    const zip = new JSZip();

    for (chapterIdx = 0; chapterIdx < chapterList.length; chapterIdx++) {
      io.emit('status', 'Generating PDF file...');
      imageDirectory = dir+'/chapter_'+chapterList[chapterIdx]
      var imageFiles = fs.readdirSync(imageDirectory).filter((file) => {
        return file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') || file.toLowerCase().endsWith('.png');
      });
      ext = (imageFiles[0].split("."))[1]
      imageFiles = imageFiles.map((str) => parseInt(str, 10));
      imageFiles.sort((a, b) => a - b);
      console.log(imageFiles)
      mid = Math.floor(imageFiles.length / 2)
      dim = sizeOf(dir+'/chapter_'+chapterList[chapterIdx]+'/'+imageFiles[mid]+'.'+ext)
      console.log(dim)
      const doc = new PDFDocument({ size: [dim.width, dim.height], margin: 0 })

      const writeStream = fs.createWriteStream(dir+'/chapter_'+chapterList[chapterIdx]+'.pdf');
      doc.pipe(writeStream);

      io.emit('status', 'Generating PDF file...');
      for (i = 0; i < imageFiles.length; i++) {
        donepages += 1
        io.emit('prog', [donepages, totpages]);
        if (donepages == totpages) {
          io.emit('end')
        }
        const image = dir+'/chapter_'+chapterList[chapterIdx]+'/'+imageFiles[i]+'.'+ext;
        const buffer = await compressImage(image, qlty);
        doc.image(buffer, {
          fit: [dim.width, dim.height],
          align: 'center',
          valign: 'center'
        });
        doc.addPage();
      }
      doc.end();
    }

    res.redirect("/getChapter?search="+search)
  })
  .catch((error) => {
    console.error(error);
  });
});

app.post('/CBZ', urlencodedParser, async function (req, res) {
  donepages = 0
  totpages = 0
  var io = req.io;
  chapterList = req.body.chaps.split(",")
  chapterSets = JSON.parse(req.body.sets)
  quality = req.body.quality
  format = req.body.format
  title = req.body.title
  directory = req.body.dir
  chaps = req.body.chap
  set = req.body.set
  search = req.body.url
  url = url.split("/")

  var dir = directory + '/' + title;
  dir = dir.replace('//', '/')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (quality == 'High') {
    qlty = 90;
  }
  else if (quality == "Medium") {
    qlty = 70;
  }
  else if (quality == "Low") {
    qlty = 50;
  }
  else {
    qlty = 100;
  }
  console.log(qlty)

    const archive = new JSZip();
    raw(dir, chapterList, chapterSets, qlty).then(async (result) => {

      for (chapterIdx = 0; chapterIdx < chapterList.length; chapterIdx++) {
        io.emit('status', 'Generating PDF file...');
        const output = dir+'/chapter_'+chapterList[chapterIdx]+'.cbz';
      imageDirectory = dir+'/chapter_'+chapterList[chapterIdx]
      var imageFiles = fs.readdirSync(imageDirectory).filter((file) => {
        return file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') || file.toLowerCase().endsWith('.png');
      });
          
      for (const imageFile of imageFiles) {
        const imagePath = dir+'/chapter_'+chapterList[chapterIdx]+'/'+imageFiles[i];
        const imageContent = fs.readFileSync(imagePath);
        const buffer = await compressImage(imageContent, qlty);
        archive.file(imageFile, buffer);
      }
    
      archive.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
    .pipe(fs.createWriteStream(output))
    .on('finish', () => {
    });
  }
    });
    res.redirect("/getChapter?search="+search)
});

app.post('/Raw', urlencodedParser, async function (req, res) {
  donepages = 0
  totpages = 0
  var io = req.io;
  chapterList = req.body.chaps.split(",")
  chapterSets = JSON.parse(req.body.sets)
  quality = req.body.quality
  format = req.body.format
  title = req.body.title
  directory = req.body.dir
  chaps = req.body.chap
  set = req.body.set
  search = req.body.url
  url = url.split("/")

  var dir = directory + '/' + title;
  dir = dir.replace('//', '/')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (quality == 'High') {
    qlty = 90;
  }
  else if (quality == "Medium") {
    qlty = 70;
  }
  else if (quality == "Low") {
    qlty = 50;
  }
  else {
    qlty = 100;
  }
  console.log(qlty)

  try{

    raw(dir, chapterList, chapterSets, qlty);

    res.redirect("/getChapter?search="+search)

  } catch(e){
    res.render('error.pug', { type: 1 })
  }
});

server.listen(8081, function () {

})
