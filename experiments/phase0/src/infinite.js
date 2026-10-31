import {loadPyodide} from 'pyodide';
onmessage = async () => {const py=await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'});postMessage('ready');await py.runPythonAsync('while True:\n    pass');postMessage('unexpected completion')};
