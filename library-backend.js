const mongoose = require('mongoose')
mongoose.set('strictQuery', false)

require('dotenv').config()

const MONGODB_URI = process.env.MONGODB_URI

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('connected to MongoDB')
    })
    .catch((error) => {
        console.log('error connection to MongoDB:', error.message)
        process.exit(1)
    })


const {ApolloServer} = require('@apollo/server')
const { expressMiddleware } = require('@apollo/server/express4')
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const express = require('express')
const cors = require('cors')
const http = require('http')

const { WebSocketServer } = require('ws')
const { useServer } = require('graphql-ws/use/ws')

const { PubSub } = require('graphql-subscriptions')

const {GraphQLError} = require('graphql')

const jwt = require('jsonwebtoken')

const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')

const pubsub = new PubSub()

const typeDefs = `
  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }
    
  type Token {
    value: String!
  }

  type Author {
    name: String!
    id: ID!
    born: Int
    bookCount: Int!
  }
  
  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }
  
  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
  }
  
  type Mutation {
    addBook(
      title: String!, 
      published: Int!, 
      author: String!, 
      genres: [String!]!
    ): Book!
    
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
    
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    
    login(
      username: String!
      password: String!
    ): Token 
  }
  
  type Subscription {
    bookAdded: Book!
  }
`

const resolvers = {
    Query: {
        bookCount: () => Book.collection.countDocuments(),
        authorCount: () => Author.collection.countDocuments(),
        allBooks: async (_, {author = undefined, genre = undefined}) => {

            const filters = {}

            if (genre) {
                filters.genres = {$elemMatch: {$eq: genre}}
            }

            if (author) {
                const authorObj = await Author.findOne({name: author})
                if (!authorObj) return []
                filters.author = authorObj._id
            }

            return Book.find(filters)
        },
        allAuthors: async () => {
            const authors = await Author.find().lean();
            const counts = await Book.aggregate([
                { $group: { _id: "$author", count: { $sum: 1 } } }
            ])

            const countMap = new Map(counts.map(({_id, count}) => [_id, count]))

            return authors.map(author => ({
                ...author,
                bookCount: countMap.get(author._id) || 0
            }))
        },
        me: (_, __, {currentUser}) => currentUser,
    },
    Mutation: {
        addBook: async (_, {title, published, author: authorName, genres}, {currentUser}) => {

            if (!currentUser) {
                throw new GraphQLError('not authenticated', {
                    extensions: {code: 'BAD_USER_INPUT',}
                })
            }

            let author = await Author.findOne({name: authorName})

            if (!author) {
                author = new Author({name: authorName})
                try {
                    await author.save()
                } catch (error) {
                    throw new GraphQLError('Saving author failed', {
                        extensions: {
                            code: 'BAD_USER_INPUT',
                            invalidArgs: authorName,
                            error
                        }
                    })
                }
            }

            const book = new Book({
                title,
                published,
                author: author._id,
                genres
            })

            try {
                await book.save()
            } catch (error) {
                throw new GraphQLError('Saving book failed', {
                    extensions: {
                        code: 'BAD_USER_INPUT',
                        invalidArgs: title,
                        error
                    }
                })
            }

            pubsub.publish('BOOK_ADDED', {bookAdded: book})

            return book
        },
        editAuthor: async (_, {name, setBornTo}, {currentUser}) => {
            if (!currentUser) {
                throw new GraphQLError('not authenticated', {
                    extensions: {code: 'BAD_USER_INPUT'}
                })
            }
            return Author.findOneAndUpdate(
                {name},
                {born: setBornTo},
                {new: true}
            )

        },
        createUser: async (root, {username, favoriteGenre}) => {
            const user = new User({username, favoriteGenre})
            return user.save()
                .catch(error => {
                    throw new GraphQLError('Creating the user failed', {
                        extensions: {
                            code: 'BAD_USER_INPUT',
                            invalidArgs: username,
                            error
                        }
                    })
                })
        },
        login: async (root, {username, password}) => {
            const {_id: id = undefined} = await User.findOne({username}) || {}

            if (typeof id === "undefined" || password !== 'salainen_sana') {
                throw new GraphQLError('invalid username or password', {
                    extensions: {
                        code: 'BAD_USER_INPUT'
                    }
                })
            }

            return {value: jwt.sign({username, id}, process.env.JWT_SECRET)}
        },
    },
    Subscription: {
        bookAdded: {
            subscribe: () => pubsub.asyncIterableIterator('BOOK_ADDED'),
        },
    },
    Book: {
        author: async ({author}) => Author.findById(author),
    },
    Author: {
        bookCount: async ({_id: author}) => Book.countDocuments({author}),
    },
}

const server = new ApolloServer({
    typeDefs,
    resolvers,
})

const start = async () => {
    const app = express()
    const httpServer = http.createServer(app)

    const wsServer = new WebSocketServer({
        server: httpServer,
        path: '/',
    })

    const schema = makeExecutableSchema({ typeDefs, resolvers })
    const serverCleanup = useServer({ schema }, wsServer)


    const server = new ApolloServer({
        schema: makeExecutableSchema({ typeDefs, resolvers }),
        plugins: [
            ApolloServerPluginDrainHttpServer({ httpServer }),
            {
                async serverWillStart() {
                    return {
                        async drainServer() {
                            await serverCleanup.dispose();
                        },
                    };
                },
            },
        ],
    })
    await server.start()
    app.use(
        '/',
        cors(),
        express.json(),
        expressMiddleware(server, {
            context: async ({req, res}) => {
                const auth = req ? req.headers.authorization : null
                if (auth && auth.startsWith('Bearer ')) {
                    const decodedToken = jwt.verify(
                        auth.substring(7), process.env.JWT_SECRET
                    )
                    const currentUser = await User
                        .findById(decodedToken.id)

                    return {currentUser}
                }
            }
        }),
    )
    const PORT = 4000
    httpServer.listen(PORT, () =>
        console.log(`Server is now running on http://localhost:${PORT}`)
    )
}
start()