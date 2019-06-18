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
  const botName = "urp";
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
    nick: botName,
    userName: botName,
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

  let timerState = null;
  let userList = { block: [], winners: [], losers: [] };

  const callGetGameData = (to) =>{
    if (!R.isNil(timerState)) {
      client.say(to, `До конца раунда меньше ${timerNum} секунд...`);
      return;
    }

    getGameData().then( response => {
      client.say(to, gameData.photoUrl);
      R.addIndex(R.map)( (e, i) => { client.say(to, `${++i}). ${e}`); }, gameData.titles);
    });
  };

  const startTimer = (to, gameData) => {
    callGetGameData(to);
    if (!R.isNil(timerState)) return;
    timerState = R.when(R.isNil, R.T)(timerState);

    setTimeout( () => {
      client.say(to, "Раунд завершён, правильный ответ: ");
      client.say(to, `${gameData.checked.index}). ${gameData.checked.title}`);

      const isBothEmpty = (arr) => R.and(R.isEmpty(arr[0]), R.isEmpty(arr[1]));
      R.cond([
        [
          R.compose(R.not, R.isEmpty, R.prop('winners')),
          () => client.say(to, `Победители: ${userList.winners.join(', ')}!`)
        ],
        [
          R.compose(R.not, R.isEmpty, R.prop('losers')),
          () => client.say(to, `Лошары: ${userList.losers.join(', ')}!`)
        ],
        [
          R.compose(isBothEmpty, R.props(['losers', 'winners'])),
          () => client.say(to, "Чат воздержался!")
        ]
      ])(userList);

      scoreBoard.writeScoreJSON();
      userList = { block: [], winners: [], losers: [] }; timerState = null;
    }, timerNum * 1000);
  };

  const pickAnswer = (from, to, message) => {
    if (R.isNil(timerState)) {
      client.say(to, "Чтобы начать игру используй команду !urp.");
      return;
    }

    if ( R.find(R.equals(from))(userList.block) ) {
      client.say(to, `${from}, жди окончания раунда!`);
      return;
    }

    scoreBoard.setNewItem("freenode", "users", from);
    userList.block.push(from);

    let indx = parseInt(R.match(/\d/, message)[0], 10);

    const appendToUL = R.ifElse(
      R.equals(true),
      () => {
        userList.winners.push(from);
        scoreBoard.updateItemPlus("freenode", "users", from);
        scoreBoard.updateItemPlus("freenode", "room", "s2ch");
      },
      () => {
        userList.losers.push(from);
        scoreBoard.updateItemMinus("freenode", "users", from);
        scoreBoard.updateItemMinus("freenode", "room", "s2ch");
      }
    );

    appendToUL(R.and(indx, gameData.checked.index));
  };

  const getScoreByName = (from, message) => {
    let getName = R.match(/^!urp score (.*[^\s]+)$/, R.trim(message))[1];
    let points  = scoreBoard.getItemScore("freenode", "users", getName);

    R.cond([
      [ R.isNil,      () => client.say(from, `Юзера ${getName} в таблице не найдено.`)],
      [ R.is(Number), () => client.say(from, `${getName}: ${points} очков`)]
    ])(points);
  };

  const getTopByN = (from, message) => {
    let cnt = parseInt(message.match(/\d{1,2}/)[0], 10);

    client.say(from, `Топ-${cnt} в руме:`);
    scoreBoard.getTopScore("freenode", "users", cnt).map((e, i) => {
      let k = i+1;
      client.say(from, `${k}). ${e.name}: ${e.score} очков`);
    });
  };

  const getUserScore = (from, message) => {
    let points = scoreBoard.getItemScore("freenode", "users", from);

    R.cond([
      [ R.isNil,      () => client.say(from, `Юзера ${from} в таблице не найдено.`)],
      [ R.is(Number), () => client.say(from, `${from}: ${points} очков`)]
    ])(points);
  };

  const getRoomScore = (from, message) => {
    let points = scoreBoard.getItemScore("freenode", "room", "s2ch");
    client.say(from, `s2ch: ${points} очков`);
  };

  client.addListener('message', function(from, to, message) {
    R.cond([
      [R.test(/^!urp$/),        () => startTimer(to, gameData)],
      [R.test(/^!urp help$/),   () => R.map(e => client.say(to, e), arrHelp)],
      [R.test(/^!urp \d$/),     () => pickAnswer(from, to, message)],
      [R.test(/^!urp top\d*/),  () => getTopByN(from, message)],
      [R.test(/^!urp score$/),  () => getUserScore(from, message)],
      [R.test(/^!urp room score$/),   () => getRoomScore(from, message)],
      [R.test(/^!urp score .*[^\s]+$/), () => getScoreByName(from, message)]
    ])(R.trim(message));
  });
})();
