FROM node:24
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 5200
CMD ["node", "src/index.js"]
