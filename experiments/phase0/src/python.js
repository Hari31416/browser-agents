import { loadPyodide } from 'pyodide';
self.onmessage = async ({data}) => {
 try {
  const start = performance.now();
  const py = await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'});
  await py.loadPackage(['numpy','pandas','matplotlib']);
  const ready = performance.now();
  py.FS.writeFile('/input.csv','x,y\n1,2\n2,4\n3,6\n');
  await py.runPythonAsync(`import numpy as np, pandas as pd, matplotlib\nmatplotlib.use('agg')\nimport matplotlib.pyplot as plt\ndf = pd.read_csv('/input.csv')\nresult = float(np.mean(df['y']))\nopen('/result.txt','w').write(f'mean={result}')\ndf.plot(x='x',y='y')\nplt.savefig('/chart.png')`);
  const result = new TextDecoder().decode(py.FS.readFile('/result.txt'));
  const png = py.FS.readFile('/chart.png');
  const versions=py.runPython("import json, numpy, pandas, matplotlib; json.dumps({'numpy':numpy.__version__, 'pandas':pandas.__version__, 'matplotlib':matplotlib.__version__})");
  const pyFetch=await py.runPythonAsync("from pyodide.http import pyfetch\nresponse = await pyfetch('http://127.0.0.1:5173/')\nresponse.status");
  const jsFetch=await py.runPythonAsync("from js import fetch\nresponse = await fetch('http://127.0.0.1:5173/')\nresponse.status");
  let fetchResult; try { const response = await fetch('/'); fetchResult=`status ${response.status}`; } catch(e) {fetchResult=String(e)}
  self.postMessage({ok:true,loadMs:Math.round(ready-start),totalMs:Math.round(performance.now()-start),result,pngBytes:png.length,fetchResult,pyFetch,jsFetch,versions:JSON.parse(versions),python:py.runPython('import sys; sys.version')});
 } catch(e){self.postMessage({ok:false,error:String(e),stack:e.stack})}
};
