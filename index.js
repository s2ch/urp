;(function () {
  "use strict";

  const request = require("request");
  const cheerio = require("cheerio");
  const fs      = require("fs");
  const irc     = require("irc");
  const R       = require("ramda");

  const score      = require("./lib/game_score");
  const scoreBoard = score.scoreBoard;

  const gameData = { checked: { index: 0, title: "" }, titles: [], photoUrl: "" };
  const timerNum = 60; // timer value in seconds
  const answers = 5; // set the number of possible answers in this variable
  const arrHelp  = [
    "Игра «Угадай работу пидора по фото» v. 1.1.0",
    "Идея принадлежит worstie, реализовал carmack",
    "!urp - запустить раунд.",
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
    channels: ['#carmackTest'],
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
  const getDateToSec = () => Math.floor(Date.now() / 1000);
  const randMinMax   = (min, max) => Math.floor(Math.random() * (max - min) + min);
  const shuffleArray = arr => arr.map(a => [Math.random(), a]).sort((a, b) => a[0] - b[0]).map(a => a[1]);

  const getResumePageData = () => {
    return new Promise( (resolve, reject) => {
      let headers = {
        'method': 'GET',
        'url': `https://www.avito.ru/rossiya/rezume?i=1&p=${randMinMax(1, 100)}`,
        'headers': {
          'Host': 'www.avito.ru',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:66.0) Gecko/20100101 Firefox/66.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      };

      let cb = (err, res, body) => {
        let data = [];
        let $ = cheerio.load(body);

        $('.js-catalog_serp .item_resume').each(function () {
          let descTitleLink = $(this).find('.item-description-title-link');
          let descTitleText = $(this).find('.data>p:first-child').text();

          data.push(
            {
              "desc": descTitleText,
              "title": descTitleLink.attr('title'),
              "href": descTitleLink.attr('href'),
              "checked": false,
              "img": ""
            }
          );
        });

        return R.ifElse(
          R.propEq(data.length, 0),
          R.prop(false),
          R.prop(resolve(data))
        );

        resolve(data);
      };

      request(headers, cb);
    });
  };

  const getDetailPageData = () => {
    return new Promise((resolve, reject) => {
      const randDate = Date.now();
      const randGender = R.cond([
        [R.equals(0), R.always("Мужчина")],
        [R.equals(1), R.always("Женщина")]
      ]);

      const isGender = e => e.desc.match(new RegExp(randGender(randDate % 2), "i"));

      getResumePageData().then(data => {
        let currentGenderList = shuffleArray(R.filter(isGender, data));
        let randEntry = R.take(answers, currentGenderList);
        let pickedAnsw = randEntry[randMinMax(0, answers - 1)];
        pickedAnsw.checked = true;

        let headers = {
          'method': 'GET',
          'url': `https://www.avito.ru${pickedAnsw.href}`,
          'headers': {
            'Host': 'www.avito.ru',
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:66.0) Gecko/20100101 Firefox/66.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        };

        let cb = (err, res, body) => {
          let $  = cheerio.load(body), imgUrl;
          imgUrl = "https:" + $(".gallery-img-frame img").attr("src").replace(/640x480/, '1280x960');
          pickedAnsw.img = imgUrl;
          resolve(randEntry);
        };

        request(headers, cb);
      });
    });
  };

  const getGameData = () => {
    return new Promise( (resolve, reject) => {
      getDetailPageData().then( data => {
        gameData.checked.index = R.findIndex(R.propEq('checked', true))(data) + 1;
        gameData.checked.title = R.find(R.propEq('checked', true))(data).title;
        gameData.photoUrl      = R.find(R.propEq('checked', true))(data).img;
        gameData.titles        = R.map(e => R.view(R.lensProp("title"), e), data);

        resolve(gameData);
      });
    });
  };

  let timer   = {start: 0, stop: 0, timeLeft: 0};
  let userList = { block: [], winners: [], losers: [] };

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

          for (let i = 0, k = 1; i < answers; i++, k++ ) {
            client.say(to, `${k}). ${gameData.titles[i]}`);
          }
        });

        // Stop
        setTimeout(function () {
          client.say(to, "Раунд завершён, правильный ответ: ");
          client.say(to, `${gameData.checked.index}). ${gameData.checked.title}`);

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
          client.say(to, `До окончания раунда меньше ${timer.timeLeft} секунд.`);
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
        client.say(to, `${from}, жди окончания раунда!`);
      } else {
        scoreBoard.setNewItem("freenode", "users", from);
        userList.block.push(from);

        if ( parseInt(message.match(/\d/)[0], 10) === gameData.checked.index) {
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

    // Help block
    if ( message.match(/^!urp help$/) ) {
      arrHelp.map((e, i) => client.say(to, e));
    }

    // Stats block
    if ( message.match(/^!urp top\d*$/) ) {
      let cnt = parseInt(message.match(/\d{1,2}/)[0], 10);

      client.say(from, `Топ-${cnt} в руме:`);
      scoreBoard.getTopScore("freenode", "users", cnt).map((e, i) => {
        let k = i+1;
        client.say(from, `${k}). ${e.name}: ${e.score} очков`);
      });
    }

    if ( message.match(/^!urp score$/) ) {
      let points = scoreBoard.getItemScore("freenode", "users", from);
      client.say(from, `${from}: ${points} очков`);
    }

    if ( message.match(/^!urp score (.*[^\s]+)$/) && !message.match(/^!urp score s2ch$/)) {
      let getName = message.match(/^!urp score (.*[^\s]+)$/)[1];
      let points  = scoreBoard.getItemScore("freenode", "users", getName);
      client.say(from, `${getName}: ${points} очков`);
    }

    if ( message.match(/^!urp score s2ch$/) ) {
      let points = scoreBoard.getItemScore("freenode", "room", "s2ch");
      client.say(from, `s2ch: ${points} очков`);
    }
  });
})();
