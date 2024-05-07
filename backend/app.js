const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors'); 
const bodyParser = require('body-parser');

const app = express();
const port = 3000; // You can choose any port you like

const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
  methods: ['GET', 'PUT', 'UPDATE', 'DELETE']  
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
 
app.get('/api/volumes', async (req, res) => {
  try {
    const directoryPath = '/mnt/';
    const volumes = await fs.readdir(directoryPath);
    const volumeData = volumes.map((volume) => {
      return {
        name: volume,
        path: volume
      };
    });
    res.json(volumeData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while fetching the volumes.' });
  }
});


// Endpoint to get file information
app.get('/api/browse/*', async (req, res) => {
  const directoryPath = `/mnt/${req.params[0]}`; // Replace with your directory path

  try {
    const files = await fs.readdir(directoryPath);
    const fileData = [];

    // Use Promise.all to read file stats asynchronously
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(directoryPath, file);
        const stats = await fs.stat(filePath);

        let extension = file.split(".").splice(-1)[0]
        if(extension.length > 10) extension='unknown'

        let item = {
          name: file,
          path: req.params[0], 
          dateModified: stats.mtime,
          size: stats.size,
          kind: extension
        }

        if (stats.isFile()) {
          item.kind = extension
        }
        else if(stats.isDirectory()){
          item.kind = 'directory'
        }
        fileData.push(item);
      })
    );

    res.json(fileData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while reading the directory.' });
  }
});


app.get('/api/file/:path', (req, res) => {
  const filePath = "/mnt/"+req.params.path
  console.log("hitting file endpoint")
  console.log(filePath)

  fs.readFile(filePath, { encoding: 'utf-8' }, (err, data) => {
      if (err) {
          console.error('Error reading the file:', err);
          return res.status(500).send('Failed to read file.');
      }
      res.send(data);
  });
});


app.post('/api/editor', async (req, res) => {
  const basePath = "/mnt";
  const safeFilePath = path.join(basePath, req.body.path.replace(/\.\./g, ''));

  try {
    const data = await fs.readFile(safeFilePath, { encoding: 'utf-8' });
    console.log(data);
    res.send({ content: data });
  } catch (err) {
    console.error('Error reading the file:', err);
    res.status(500).json({ error: 'Failed to read file.' });
  }
});


app.put('/api/editor', (req, res) => {
  const filePath = "/mnt/"+ request.body.path
  const content = req.body.content; // Assuming the new content is passed as a JSON payload

  fs.writeFile(filePath, content, (err) => {
      if (err) {
          console.error('Error writing to the file:', err);
          return res.status(500).send('Failed to update file.');
      }
      res.send('File updated successfully.');
  });
});


app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});
