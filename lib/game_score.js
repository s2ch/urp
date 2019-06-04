"use script";

const fs = require("fs");

class ScoreBoard {
  constructor(pathname) {
    this.pathname = pathname || "score.json";

    if (fs.existsSync(this.pathname)) {
      this.scoreJSONFile = fs.readFileSync(this.pathname, "utf8");
      this.scoreObj = JSON.parse(this.scoreJSONFile);
      console.log(this.scoreObj);
    } else {
      // default object
      this.scoreObj = {"freenode": {"room": {"name": "s2ch", "score": 0}, "users": [] }};
      console.log(this.scoreObj);
    }
  }

  getItemScore (channel, group, name) {
    return this.scoreObj[channel][group].filter( (e, i) => {
      return e.name.indexOf(name) > -1;
    })[0].score;
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

  updateItemPlus (channel, group, name) {
    return this.scoreObj[channel][group].filter( (e, i) => {
      return e.name.indexOf(name) > -1;
    })[0].score += 5;
  }

  updateItemMinus (channel, group, name) {
    return this.scoreObj[channel][group].filter( (e, i) => {
      return e.name.indexOf(name) > -1;
    })[0].score += -5;
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

module.exports.scoreBoard = ScoreBoard;
