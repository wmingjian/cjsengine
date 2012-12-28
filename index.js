/*
CJS文件执行引擎
@copyright 2012 alz <wmingjian@qq.com>
@license MIT
*/
var fs = require("fs");
var path = require("path");
var vm = require("vm");

function Module(){
	this.exports = {};
}
Module.prototype = {
	_compile: function(engine, content, filename){
		var sandbox = {};
		var vars = engine.options.vars;
		for(var i = 0, len = vars.length; i < len; i++){
			var k = vars[i];
			sandbox[k] = global[k];
		}
		//module, require, exports, __dirname, __filename
		sandbox.require = engine.options.my_require;
		sandbox.exports = this.exports;
		sandbox.__filename = filename;
		sandbox.__dirname = path.dirname(filename);
		sandbox.module = this;
		sandbox.global = sandbox;
		//sandbox.root = root;
		vm.runInNewContext(content, sandbox, filename);
	}
};

/*
engine.invokeCjs(stats, filename);
*/
function CjsEngine(options){
	this._files = {};  //cjs文件缓存
	this.options = {  //默认配置
		"path_base": __dirname,
		"fileext": ".cjs",
		"params": "",
		"vars": [
			//"ArrayBuffer", "Int8Array", "Uint8Array", "Int16Array", "Uint16Array",
			//"Int32Array", "Uint32Array", "Float32Array", "Float64Array", "DataView",
			//"process", "global", "GLOBAL", "root",
			"Buffer",
			"setTimeout", "setInterval", "clearTimeout", "clearInterval",
			"console"
		],
		"my_require": function(path){
			console.log("my_require " + path);
			return require(path);
		}
	};
	for(var k in options){
		this.options[k] = options[k];
	}
}
CjsEngine.prototype = {
	callback: function(cb, statusCode, ex){
		if(statusCode === 500){
			console.error(ex.stack);  //[TODO]
		}
		cb(statusCode, ex);
	},
	execFunc: function(func, params, cb){
		try{
			func.apply(null, params);  //执行文件内容
		}catch(ex){  //执行出错
			this.callback(cb, 500, ex);
		}
	},
	invokeCjs: function(stats, filename, params, cb){
		var mtime = stats.mtime,
			cache = this._files[filename],
			func;
		if(cache && cache.mtime >= mtime){  //判断缓存是否有效？
			func = cache.func;
			this.execFunc(func, params, cb);
		}else{
			var me = this;
			fs.readFile(filename, "utf8", function(ex, code){
				if(ex){  //读文件出错
					me.callback(cb, 500, ex);
				}else{
					var content = "exports.__main__ = function(" + me.options.params + "){\n" + code + "\n};";
					var module = new Module();  //[TODO]模块可能已经存在
					try{
						module._compile(me, content, filename)
					}catch(ex){  //编译出错
						me.callback(cb, 500, ex);
						return;
					}
					func = module.exports.__main__;
					me._files[filename] = {
						"module"  : module,
					//"filename": filename,
					//"size"    : stats.size,
						"mtime"   : mtime,
						"code"    : code,
						"func"    : func
					};
					me.execFunc(func, params, cb);
				}
			});
		}
	},
	invoke: function(pathname, params, cb){
		var opts = this.options;
		var filename = opts.path_base + pathname;
		var me = this;
		fs.stat(filename, function(ex, stats){
			if(ex){  //读文件状态出错
				me.callback(cb, 500, ex);
			}else{
				if(stats.isDirectory()){  //目录
					me.callback(cb, 403);  //[TODO]暂时禁止查看目录内容
				}else if(stats.isFile()){  //文件
					var ext = path.extname(filename);
					if(ext == opts.fileext){  //解释执行
						me.invokeCjs(stats, filename, params, cb);
					}else{
						me.callback(cb, 403);
					}
				}else{
					me.callback(cb, 403);
				}
			}
		});
	}
};

exports.CjsEngine = CjsEngine;
exports.create = function(options){
	return new CjsEngine(options);
};