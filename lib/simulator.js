// Main PythonIDE object
var PythonIDE = {
	// file currently being edited
	currentFile: 'mycode.py',
	// stores each of the files in the project
	files: { 'mycode.py': '' },
	// callback function to allow python (skulpt) to read from a file
	readFile: function (filename) {
		return PythonIDE.files[filename];
	},
	// functions and data needed for running theh python code
	python: {
		outputListeners: [],
		output: function (text, header) {
			var id = header == undefined ? 'consoleOut' : 'headerOut';
			var c = document.getElementById(id);
			c.innerHTML += text;

			var i = 0;
			while (i < PythonIDE.python.outputListeners.length) {
				var l = PythonIDE.python.outputListeners[i];
				try {
					l(text);
					i++;
				} catch (e) {
					PythonIDE.python.outputListeners.splice(i, 1);
				}
			}
			var c = c.parentNode.parentNode;
			c.scrollTop = c.scrollHeight;

		},
		clear: function () {
			var c = document.getElementById('consoleOut');
			c.innerHTML = '';
			var c = c.parentNode.parentNode;
			c.scrollTop = c.scrollHeight;
		},
		builtinread: function (x) {
			if (Sk.builtinFiles === undefined || Sk.builtinFiles["files"][x] === undefined)
				throw "File not found: '" + x + "'";
			return Sk.builtinFiles["files"][x];
		}
	},
	// convenience function that allows modules to run syncronous code asyncrounously.
	// For example time.sleep needs to pause the python program but shouldn't make the browser unresponsive
	runAsync: function (asyncFunc) {
		var p = new Promise(asyncFunc);
		var result;
		var susp = new Sk.misceval.Suspension();
		susp.resume = function () {
			return result;
		}
		susp.data = {
			type: "Sk.promise",
			promise: p.then(function (value) {
				result = value;
				return value;
			}, function (err) {
				result = "";
				PythonIDE.handleError(err);
				return new Promise(function (resolve, reject) {
				});
			})
		};
		return susp;
	},

	// run the code in the editor
	// runMode can be "anim" to step through each line of python code or "normal" to run the whole code as fast as possible
	runCode: function (runMode = "normal") {
		if (PythonIDE.unhandledError)
			delete PythonIDE.unhandledError;
		if (PythonIDE.animTimeout && runMode != "anim") {
			clearTimeout(PythonIDE.animTimeout);
			delete PythonIDE.animTimeout;
			return;
		}
		if (PythonIDE.continueDebug) {
			if (runMode != "normal") {
				PythonIDE.continueDebug();
				return;
			}
		}

		PythonIDE.runMode = runMode;
		PythonIDE.python.outputListeners = [];

		var code = PythonIDE.files['mycode.py'];
		var html = '';
		html += '<div id="headerOut"></div>';
		html += '<pre id="consoleOut"><div id="watch"><h2>Variables:</h2></div></pre>';
		html += '</pre>';
		if (code.indexOf("turtle") > 0) {
			html += '<div id="canvas"></div>';
		}
		html += '<div><button id="btn_stop">Stop</button><button id="btn_hideConsole">Hide</button></div>';

		$('#output').html(html);
		$('#dlg').dialog("open");

		$('#btn_stop').button().click(function () {
			localStorage.loadAction = "restoreCode";
			window.location = window.location.href.replace('run/', 'python/');
		});

		if (!PythonIDE.whenFinished) {
			$('#btn_hideConsole').button().click(function () {
				$('#dlg').dialog("close");
			});
		} else {
			$('#btn_hideConsole').hide();
		}

		var handlers = [];
		if (runMode != "normal") {
			handlers["Sk.debug"] = function (susp) {
				// globals
				//console.log(susp.child);
				var html = '<h2>Global variables:</h2><table><tr><th>Name</th><th>Data type</th><th>Value</th></tr>';
				PythonIDE.watchVariables.expandHandlers = [];
				for (var key in susp.child.$gbl) {
					var pyVal = susp.child.$gbl[key];
					var val = JSON.stringify(Sk.ffi.remapToJs(pyVal));

					if (val === undefined) {
						val = "";
					}

					if (val && val.length && val.length > 20) {
						var eH = { "id": PythonIDE.watchVariables.expandHandlers.length, "fullText": val, "shortText": val.substring(0, 17) };

						PythonIDE.watchVariables.expandHandlers.push(eH);
						val = '<span class="debug_expand_zone" id="debug_expand_' + eH.id + '">' + val.substring(0, 17) + '<img src="media/tools.png" class="debug_expand" title="Click to see full value"></span>';
					}

					var type = pyVal.skType ? pyVal.skType : pyVal.__proto__.tp$name;
					if (type == "function") {
						continue;
					}
					if (type == "str") {
						type = "string";
					}
					if (type === undefined) {
						//console.log(pyVal, val, type);
						continue;
					}
					html += '<tr><td>' + key + '</td><td>' + type + '</td><td>' + val + '</td></tr>';
				}
				html += '</table>';



				$('#watch').html(html);

				$('span.debug_expand_zone').click(function (e) {
					var id = e.currentTarget.id;
					var idNum = id.replace("debug_expand_", "");
					$('#' + id).html(PythonIDE.watchVariables.expandHandlers[idNum].fullText);
				});

				var p = new Promise(function (resolve, reject) {
					PythonIDE.continueDebug = function () {
						return resolve(susp.resume());
					}

					PythonIDE.abortDebug = function () {
						delete PythonIDE.abortDebug;
						delete PythonIDE.continueDebug;
						return reject("Program aborted");
					}

				});
				return p;
			}
			setTimeout(function () { PythonIDE.runCode(runMode); }, 100);
			$('#watch').show();
		} else {
			// if code contains a while loop
			if ((code.indexOf("while ") > -1) && (code.indexOf("sleep") == -1)) {
				console.log("Crash prevention mode enabled: This happens when your code includes an infinite loop without a sleep() function call. Your code will run much more slowly in this mode.");
				var startTime = new Date().getTime();
				var lineCount = 0;
				handlers["Sk.debug"] = function (susp) {
					lineCount++;
					if (new Date().getTime() - startTime > 100) {
						if (lineCount < 100) {
							return;
						}
						startTime = new Date().getTime();
						var p = new Promise(function (resolve, reject) {
							setTimeout(function () {
								console.log("Limiting speed to avoid crashing the browser: " + (lineCount * 10) + " lines per second");
								lineCount = 0;
								return resolve(susp.resume());
							}, 50);

						});
						return p;
					}
				};
			}
		}
		Sk.misceval.callsimAsync(handlers, function () {
			return Sk.importMainWithBody("mycode", false, code, true);
		}).then(function (module) {
			if (PythonIDE.continueDebug)
				delete PythonIDE.continueDebug;
			if (PythonIDE.abortDebug)
				delete PythonIDE.abortDebug;
			$('#btn_stop').hide();
			$('#btn_stopRunning').removeClass('visibleButton').addClass('hiddenButton');
			if (PythonIDE.whenFinished) {
				PythonIDE.whenFinished();
			}
		}, PythonIDE.handleError);

	},

	// display errors caught when the python code runs
	handleError: function (err) {
		if(!PythonIDE.unhandledError && PythonIDE.continueDebug) {
			PythonIDE.unhandledError = err;
			return;
		}
		alert(err.toString());
	},

	// initialise the python ide
	init: function (style) {
		PythonIDE.editor = CodeMirror(document.getElementById('editor'), {
			value: PythonIDE.files['mycode.py'],
			mode: 'python',
			lineNumbers: true,
			styleActiveLine: true,
			inputStyle: "textarea"
		});
		PythonIDE.editor.addKeyMap({
			"Tab": function (cm) {
				if (cm.somethingSelected()) {
					var sel = PythonIDE.editor.getSelection("\n");
					// Indent only if there are multiple lines selected, or if the selection spans a full line
					if (sel.length > 0 && (sel.indexOf("\n") > -1 || sel.length === cm.getLine(cm.getCursor().line).length)) {
						cm.indentSelection("add");
						return;
					}
				}

				if (cm.options.indentWithTabs)
					cm.execCommand("insertTab");
				else
					cm.execCommand("insertSoftTab");
			},
			"Shift-Tab": function (cm) {
				cm.indentSelection("subtract");
			}
		});
		if (style != "embed" && style != "run") {
			PythonIDE.editor.focus();
		}
		PythonIDE.editor.on("change", function (e) {
			if (PythonIDE.abortDebug) {
				PythonIDE.abortDebug();
			}
			PythonIDE.files[PythonIDE.currentFile] = PythonIDE.editor.getValue();
		});


		window.onerror = function (err) {
			alert(err.toString());
			return true;
		}

		$('#dlg,#settings,#login,#share,#file_settings, #recover').dialog({
			autoOpen: false,
			width: window.innerWidth * 0.8,
			height: window.innerHeight * 0.7
		});

		(Sk.TurtleGraphics || (Sk.TurtleGraphics = {})).target = 'canvas';

		Sk.inputfun = function (prompt) {
			//return window.prompt(prompt);
			var p = new Promise(function (resolve, reject) {
				if ($('#raw_input_holder').length > 0) {
					return;
				}
				PythonIDE.python.output('<form><div id="raw_input_holder"><label for="raw_input">' + prompt + '</label><input type="text" name="raw_input" id="raw_input" value=""/><button id="raw_input_accept" type="submit">OK</button></div></form>');

				var btn = $('#raw_input_accept').button().click(function () {
					var val = $('#raw_input').val();
					$('#raw_input_holder').remove();
					PythonIDE.python.output(prompt + ' <span class="console_input">' + val + "</span>\n");
					resolve(val);
				});
				$('#raw_input').focus();
			});
			return p;
		}

		Sk.configure({
			breakpoints: function (filename, line_number, offset, s) {
				//console.log(line_number, PythonIDE.runMode);
				if (PythonIDE.runMode == "anim") {
					if (PythonIDE.continueDebug) {
						PythonIDE.animTimeout = setTimeout(function () {
							PythonIDE.runCode("anim");
						}, $("#slider_step_anim_time").slider("value"));
					}
				}
				PythonIDE.editor.setCursor(line_number - 1);

				// check for errors in external libraries
				if (PythonIDE.unhandledError) {
					throw PythonIDE.unhandledError;
				}
				return true;
			},
			debugging: true,
			output: PythonIDE.python.output,
			readFile: PythonIDE.readFile,
			read: PythonIDE.python.builtinread
		});

		// add in additional libraries.
		// not all of these are complete but they serve as an example of how you can code your own modules.
		Sk.externalLibraries = {
			// microbit simulator
			microbit: {
				path: 'lib/skulpt/microbit/__init__.js'
			},
			// music module compatible with microbit music module
			music: {
				path: 'lib/skulpt/music/__init__.js'
			}
		};
	}
}
