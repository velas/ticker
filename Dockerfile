FROM node:latest

ENV HTTP_PORT	 5000
ENV EXPLORER_URL http://127.0.0.1:4000/api
ENV CMC_LIMIT 	 2500
ENV DEBUG 	 false

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000

CMD [ "node", "index.js" ]
