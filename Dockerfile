FROM node:20-alpine

WORKDIR /app

COPY package*.json bun.lock ./

RUN npm install

COPY . .

ENV NODE_ENV=production

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
