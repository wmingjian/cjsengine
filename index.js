/*
CJS文件执行引擎
@copyright 2012-2013 alz <wmingjian@qq.com>
@license MIT
*/
var fs = require("fs");
var path = require("path");
var vm = require("vm");

function merge(dest, src){
	for(var k in src){
		dest[k] = src[k];
	}
}

function Module(){
	this.exports = {};
}
Module.prototype = {
	_compile: function(engine, content, filename){
		var sandbox = {};
		var vars = engine.opts.vars;
		for(var i = 0, len = vars.length; i < len; i++){
			var k = vars[i];
			sandbox[k] = global[k];
		}
		//module, require, exports, __dirname, __filename
		sandbox.require = engine.opts.my_require;
		sandbox.exports = this.exports;
		sandbox.__filename = filename;
		sandbox.__dirname = path.dirname(filename);
		sandbox.module = this;
		sandbox.global = sandbox;
		//sandbox.root = root;
		vm.runInNewContext(content, sandbox, filename);
	}
};

function Parser(engine, params){
	this.engine = engine;
	this.params = params;
}
Parser.prototype = {
	compile: function(code){
		var content;
		if(/^function *\([\w, ]*\) *\{/.test(code)){  //\r?\n
			content = "exports.__main__ = " + code + ";";
		}else{
			content = "exports.__main__ = function(" + this.params + "){\n" + code + "\n};";
		}
		//console.log(content);
		return content;
	},
};

/*
engine.invokeCjs(stats, filename);
*/
function CjsEngine(){
	this._files = {};  //cjs文件缓存
	this._parsers = {};
	this.opts = {  //默认配置
		"path_base": __dirname,
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
		},
		"fileexts": {
			".cjs": 1
		},
		"params": "",
		"parser": {
			".cjs": this,
			".jsc": this
		}
	};
}
CjsEngine.prototype = {
	init: function(options){
		var opts = this.opts;
		for(var k in options){
			switch(k){
			case "fileexts":
			case "parser"  : merge(opts[k], options[k]);break;
			default        : opts[k] = options[k];break;
			}
		}
		for(var k in opts.parser){
			this._parsers[k] = this.createParser(opts.parser[k]);
		}
	},
	createParser: function(conf){
		var clazz, params;
		if(conf instanceof Array){
			clazz = this.opts.my_require(conf[0]).Parser;
			params = conf[1];
		}else{
			clazz = Parser;
			params = this.opts.params;
		}
		//console.log(clazz.toString(), params);
		return new clazz(this, params);
	},
	callback: function(cb, statusCode, ex){
		if(statusCode === 500){
			console.error(ex.stack);  //[TODO]
		}
		cb(statusCode, ex);
	},
	//[TODO]回调函数只有出错的时候才会被调用
	execFunc: function(func, argv, cb){
		try{
			var ret = func.apply(argv[2], argv);  //执行文件内容
			cb(0, null, ret);
		}catch(ex){  //执行出错
			this.callback(cb, 500, ex);
		}
	},
	compileFunc: function(ext, filename, mtime, code){
		var parser = this._parsers[ext];
		var content = parser.compile(code);
		var module = new Module();  //[TODO]模块可能已经存在
		try{
			module._compile(this, content, filename);
		}catch(ex){  //编译出错
			throw [500, ex, "compile error"];
		}
		var func = module.exports.__main__;
		this._files[filename] = {
			"module"  : module,
		//"filename": filename,
		//"size"    : stats.size,
			"mtime"   : mtime,
			"code"    : code,
			"func"    : func
		};
		return func;
	},
	invokeCjs: function(stats, ext, filename, argv, cb){
		var mtime = stats.mtime,
			cache = this._files[filename],
			func;
		if(cache && cache.mtime >= mtime){  //判断缓存是否有效？
			func = cache.func;
			this.execFunc(func, argv, cb);
		}else{
			var me = this;
			fs.readFile(filename, "utf8", function(ex, code){
				if(ex){  //读文件出错
					me.callback(cb, 500, ex);
				}else{
					try{
						var func = me.compileFunc(ext, filename, mtime, code);
						return me.execFunc(func, argv, cb);
					}catch(ex){
						me.callback(cb, ex[0], ex[1], ex[2]);
					}
				}
			});
		}
	},
	_invoke: function(ext, pathname, argv, cb){
		var opts = this.opts;
		var filename = opts.path_base + pathname;
		var me = this;
		fs.stat(filename, function(ex, stats){
			if(ex){  //读文件状态出错
				me.callback(cb, 500, ex);
			}else{
				if(stats.isDirectory()){  //目录
					me.callback(cb, 403);  //[TODO]暂时禁止查看目录内容
				}else if(stats.isFile()){  //文件
					if(ext in opts.fileexts || ext in me._parsers){  //解释执行
						me.invokeCjs(stats, ext, filename, argv, cb);
					}else{
						me.callback(cb, 403);
					}
				}else{
					me.callback(cb, 403);
				}
			}
		});
	},
	invoke: function(pathname, argv, cb){
		this._invoke(path.extname(pathname), pathname, argv, cb);
	},
	//同步接口
	//[TODO]回调函数只有出错的时候才会被调用
	execFuncSync: function(func, argv){
		try{
			return func.apply(argv[2], argv);  //执行文件内容
		}catch(ex){  //执行出错
			throw [500, ex, "execFuncSync error"];
		}
	},
	invokeCjsSync: function(stats, ext, filename, argv){
		var mtime = stats.mtime,
			cache = this._files[filename],
			func;
		if(cache && cache.mtime >= mtime){  //判断缓存是否有效？
			func = cache.func;
		}else{
			var code = fs.readFileSync(filename, "utf8");
			func = this.compileFunc(ext, filename, mtime, code);
		}
		return this.execFuncSync(func, argv);
	},
	_invokeSync: function(ext, pathname, argv){
		var opts = this.opts;
		var filename = opts.path_base + pathname;
		var stats = fs.statSync(filename);
		if(stats.isDirectory()){  //目录
			throw [403, "dir can not invoke"];  //[TODO]暂时禁止查看目录内容
		}else if(stats.isFile()){  //文件
			if(ext in opts.fileexts || ext in this._parsers){  //解释执行
				return this.invokeCjsSync(stats, ext, filename, argv);
			}else{
				throw [403, "file type error"];
			}
		}else{
			throw [403, "is not a file"];
		}
	},
	invokeAs: function(ext, pathname, argv, cb){
		if(typeof cb == "function"){
			this._invoke(ext, pathname, argv[2], argv, cb);
		}else{
			return this._invokeSync(ext, pathname, argv);
		}
		/*
		if(ext in opts.parser){
			var conf = opts.parser[ext];
			var mdlName = conf[0];  //parser_asp
			var params = conf[1];
			var parser = require("./tools/" + mdlName);
			var code = parser.compile(filename, ext.substr(1), params);
			var f = eval("(" + code + ")");
			return f.apply(null, argv);
		}
		*/
	}
};

exports.CjsEngine = CjsEngine;
exports.create = function(options){
	var engine = new CjsEngine()
	engine.init(options);
	return engine;
};