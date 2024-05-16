# Dockerfile
FROM node:lts

RUN apt-get update && \
    apt-get install -y ffmpeg
    
WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir /uploads

EXPOSE 3000

CMD ["npm", "start"]