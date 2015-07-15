cjsengine = cloud javacript engine

为一般的基于node实现的web服务器添加服务端动态脚本功能支持

具体用法：

```javascript
var path = require("path");
var cjsengine = require("cjsengine");

var path_base = path.resolve(__dirname, "..");
//cjsengine配置
var conf = {
  "path_base" : path_base,
  "path_lib"  : path_base + "/lib/",
  "my_require": function(path){
    //console.log("my_require " + path);
    if(/^#\w+$/.test(path)){
      return require(con.path_lib + path.substr(1));
    }else if(/^\.\//.test(path)){
      return require(path_base + "/" + path);
    }else if(/^\.\.\//.test(path)){
      return require(path_base + "/../" + path);
    }else{
      return require(path);
    }
  },
  "fileexts": {
    ".cjs": 1
  },
  "params": "a, b, c"
};
var engine = cjsengine.create(conf);
engine.invoke("/handle_xxx.cjs", [true, 123, "abc"], function(){
	console.log("engine invoke callback:", arguments);
});
```