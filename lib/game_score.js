"use script";

const fs = require("fs");

class ScoreBoard {
  constructor(pathname) {
    this.pathname = pathname || "score.json";

    if (fs.existsSync(this.pathname)) {
      this.scoreJSONFile = fs.readFileSync(this.pathname, "utf8");
      this.scoreObj = JSON.parse(this.scoreJSONFile);
    } else {
      // default object
      this.scoreObj = {"freenode": {"room": [{"name": "s2ch", "score": 0}], "users": [] }};
    }
  }

  getItemScore (channel, group, name) {
    let user = this.scoreObj[channel][group].filter( (e, i) => {
      return e.name.indexOf(name) > -1;
    });

    return user.length === 0 ? null : user[0].score;
  }

  getTopScore (channel, group, count) {
    let sortFn = (next, prev) => {
      if (next.score > prev.score) {
        return -1;
      }

      if (next.score < prev.score) {
        return 1;
      }

      return 0;
    };

    return this.scoreObj[channel][group].sort(sortFn).slice(0, count);
  }

  setNewItem (channel, group, name) {
    let flag = () => {
      return this.scoreObj[channel][group].map( (e, i) => {
        return e.name.indexOf(name) > -1;
      });
    };

    if ( flag().indexOf(true) < 0 ) {
      return this.scoreObj[channel][group].push({"name": name, "score": 0});
    }

    return false;
  }

  updateItemPlus (channel, group, name, value) {
    return this.scoreObj[channel][group].filter( (e, i) => {
      return e.name.indexOf(name) > -1;
    })[0].score += value;
  }

  updateItemMinus (channel, group, name, value) {
    return this.scoreObj[channel][group].filter( (e, i) => {
      return e.name.indexOf(name) > -1;
    })[0].score += -value;
  }

  writeScoreJSON () {
    let self = this;

    fs.writeFile(self.pathname, JSON.stringify(self.scoreObj), function(error) {
      if(error) throw error;
      let data = fs.readFileSync(self.pathname, "utf8");
      console.log(data);
    });
  }
};

module.exports.scoreBoard = new ScoreBoard();
