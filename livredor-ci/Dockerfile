FROM node:22-alpine
WORKDIR /app
COPY package.json app.js ./
RUN npm install
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "app.js"]