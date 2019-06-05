;(function () {
  "use strict";

  const request = require("request");
  const cheerio = require("cheerio");
  const fs      = require("fs");
  const irc     = require("irc");

  const score      = require("./lib/game_score");
  const scoreBoard = score.scoreBoard;

  const gameData = { answer: { index: 0, desc: "" }, answerChoices: {}, photoUrl: {} };
  const timerNum = 60; // timer value in seconds
  const additionalElems = 4; // additional elements in array, right answer plus this amount of additional elements
  const arrHelp  = [
    "Игра «Угадай работу пидора по фото» v. 1.0.1",
    "Идея принадлежит worstie, реализовал carmack",
    "!urp - запустить раунда.",
    "!urp N - выбрать вариант ответа, где N номер предлагаемых вариантов.",
    "!urp help - вызвать справку."
  ];

  // IRC client config block

  const auth = {
    key:  fs.readFileSync(__dirname + "/key.pem"),
    cert: fs.readFileSync(__dirname + "/cert.pem"),
    passphrase: fs.readFileSync(__dirname + "/passphrase").toString().trim()
  };

  const ircConfig = {
    nick: "urp",
    userName: "urp",
    password: auth.passphrase,
    secure: auth,
    sasl: true,
    selfSigned: true,
    certExpired: true,
    channels: ['#s2ch'],
    port: 6697,
    autoRejoin: true,
    floodProtection: false,
    floodProtectionDelay: 1000,
    showErrors: true,
    retryCount: 3,
    retryDelay: 2000
  };

  // IRC client on
  const client = new irc.Client('chat.freenode.net', 'urp', ircConfig);

  let timer   = {start: 0, stop: 0, timeLeft: 0};
  let userList = { block: [], winners: [], losers: [] };

  const getDateToSec = () => Math.floor(Date.now() / 1000);
  const randMinMax   = (min, max) => Math.floor(Math.random() * (max - min) + min);
  const shuffleArray = arr => arr.map(a => [Math.random(), a]).sort((a, b) => a[0] - b[0]).map(a => a[1]);

  const getRandElemsWoRepeats = (cnt = 0, elems = [], exclude = {}) => {
    let randIndx, randElems = [], indxCollection = [];

    elems.splice( elems.indexOf(exclude), 1);

    for (let i = 0; i < cnt; i++) {
      while(true) {
        randIndx = Math.floor(Math.random() * elems.length);
        if (indxCollection.indexOf(randIndx) > -1) {
          continue;
        }

        if (randElems.indexOf(elems[randIndx] < 0)) {
          randElems.push( elems[randIndx] );
          indxCollection.push( randIndx );
          break;
        }

      }
    }

    return randElems;
  };

  const getResumePageData = () => {
    let headers = {
      'method': 'GET',
      'url': `https://www.avito.ru/rossiya/rezume?i=1&p=${randMinMax(1, 100)}`,
      'headers': {
        'Host': 'www.avito.ru',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:66.0) Gecko/20100101 Firefox/66.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    };

    return new Promise((resolve, reject) => {
      let callback = (err, res, body) => {
        if (!err && res.statusCode == 200) {
          let $ = cheerio.load(body);
          let arrMale = [], arrFemale = [];

          $('.js-catalog_serp .item_resume').each(function () {
            let male = {}, female = {};
            let descTitleLink = $(this).find('.item-description-title-link');
            let descTitleText = $(this).find('.data>p:first-child').text();

            // male
            if ( descTitleText.match( /муж/i ) ) {
              male.title  = descTitleLink.attr('title');
              male.href   = descTitleLink.attr('href');
              male.gender = 'male';

              arrMale.push(male);
            }

            // female
            if ( descTitleText.match( /жен/i ) ) {
              female.title  = descTitleLink.attr('title');
              female.href   = descTitleLink.attr('href');
              female.gender = 'female';

              arrFemale.push(female);
            }
          });

          resolve([arrMale, arrFemale]);
        }
      };

      request(headers, callback);
    });
  };

  const getGameData = () => {
    let headers = {
      'method': 'GET',
      'headers': {
        'Host': 'www.avito.ru',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:66.0) Gecko/20100101 Firefox/66.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    };

    return new Promise(function (resolve, reject) {
      getResumePageData().then(data => {
        let randGenderRow = data[randMinMax(0, 2)];
        let randEntry     = randGenderRow[randMinMax(0, randGenderRow.length - 1)];
        let arrAnswers    = [randEntry.title];

        getRandElemsWoRepeats(additionalElems, randGenderRow, randEntry).map((e, i) => arrAnswers.push(e.title));
        arrAnswers = shuffleArray(arrAnswers);
        headers.url = `https://www.avito.ru${randEntry.href}`;

        let getAnswerIndx = arrAnswers.indexOf(randEntry.title) + 1;

        gameData.answerChoices = arrAnswers;
        gameData.answer.index  = getAnswerIndx;
        gameData.answer.desc   = randEntry.title;

        let callback = (err, res, body) => {
          let $  = cheerio.load(body), imgUrl;
          imgUrl = "https:" + $(".gallery-img-frame img").attr("src").replace(/640x480/, '1280x960');
          gameData.photoUrl = imgUrl;
          resolve(gameData);
        };

        request(headers, callback);
      });
    });
  };

  // irc message handler

  client.addListener('message', function(from, to, message) {
    if (from === "urp") {
      return;
    };

    // Start
    if ( message.match(/^!urp$/) ) {
      if (timer.start === 0) {
        timer.start = getDateToSec();
        timer.stop  = timer.start + timerNum;

        getGameData().then(response => {
          client.say(to, gameData.photoUrl);

          for (let i = 0, k = 1; i < gameData.answerChoices.length; i++, k++ ) {
            client.say(to, `${k}). ${gameData.answerChoices[i]}`);
          }
        });

        // Stop
        setTimeout(function () {
          client.say(to, "Раунд завершён, правильный ответ: ");
          client.say(to, `${gameData.answer.index}). ${gameData.answer.desc}`);

          if (userList.winners.length > 0) {
            client.say(to, `Победители: ${userList.winners.join(', ')}!`);
          }

          if (userList.losers.length > 0) {
            client.say(to, `Лошары: ${userList.losers.join(', ')}!`);
          }

          if (userList.losers.length === 0 && userList.winners.length === 0) {
            client.say(to, "Чат воздержался!");
          }

          timer    = {start: 0, stop: 0, timeLeft: 0};
          userList = { block: [], winners: [], losers: [] };

          scoreBoard.writeScoreJSON();
        }, timerNum * 1000);
      } else {
        if ( message.match(/^!urp$/) ) {
          //client.say(to, `До окончания раунда меньше ${timerNum} секунд.`);
        }
      }
    }

    // Time left
    timer.timeLeft = timer.stop - getDateToSec();

    if ( message.match(/^!urp \d$/) ) {
      if (timer.start === 0) {
        client.say(to, "Чтобы начать игру используй команду !urp.");
        return;
      }

      if (userList.block.indexOf(from) > -1) {
        //client.say(to, `${from}, жди окончания раунда!`);
      } else {
        scoreBoard.setNewItem("freenode", "users", from);
        userList.block.push(from);

        if ( parseInt(message.match(/\d/)[0], 10) === gameData.answer.index) {
          userList.winners.push(from);
          scoreBoard.updateItemPlus("freenode", "users", from);
          scoreBoard.updateItemPlus("freenode", "room", "s2ch");
        } else {
          userList.losers.push(from);
          scoreBoard.updateItemMinus("freenode", "users", from);
          scoreBoard.updateItemMinus("freenode", "room", "s2ch");
        }
      }
    }

    if ( message.match(/^!urp help$/) ) {
      arrHelp.map((e, i) => client.say(to, e));
    }
  });
})();
