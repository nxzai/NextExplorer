const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors'); 


const app = express();
const port = 3000; // You can choose any port you like

const corsOptions = {
  origin: '*', // Replace with your frontend application's URL
  methods: 'GET', // You can specify other HTTP methods as needed
};

// Use the CORS middleware with the specified options
app.use(cors(corsOptions));

 
app.get('/volumes', async (req, res) => {
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
app.get('/browse/*', async (req, res) => {
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

        if (stats.isFile()) {
          fileData.push({
            name: file,
            dateModified: stats.mtime,
            size: stats.size,
            kind: extension
          });
        }
        else if(stats.isDirectory()){
          fileData.push({
            name: file,
            dateModified: stats.mtime,
            size: stats.size,
            kind:'directory'
          });
        }
      })
    );

    res.json(fileData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while reading the directory.' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});
