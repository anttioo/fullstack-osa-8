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
const { GraphQLError } = require('graphql')
const {startStandaloneServer} = require('@apollo/server/standalone')

const Book = require('./models/book')
const Author = require('./models/author')

const typeDefs = `
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
  }
`

const resolvers = {
    Query: {
        bookCount: () => Book.collection.countDocuments(),
        authorCount: () => Author.collection.countDocuments(),
        allBooks: async (_, {author = undefined, genre = undefined}) => {

            const filters = {}

            if (genre) {
                filters.genres = { $elemMatch: { $eq: genre } }
            }

            if (author) {
                const authorObj = await Author.findOne({ name: author })
                if (!authorObj) return []
                filters.author = authorObj._id
            }

            return Book.find(filters)
        },
        allAuthors: async () => {
            return Author.find({})
        },
    },
    Mutation: {
        addBook: async (_, {title, published, author: authorName, genres}) => {

            let author = await Author.findOne({ name: authorName })

            if (!author) {
                author = new Author({ name: authorName })
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
                author,
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
            return book
        },
        editAuthor: async (_, {name, setBornTo}) => {
            return Author.findOneAndUpdate(
                { name },
                { born: setBornTo },
                { new: true }
            )

        },
    },
    Book: {
        author: async (root) => {
            return Author.findById(root.author)
        },
    },
    Author: {
        bookCount: async (root) => {
            return Book.countDocuments({ author: root._id })
        },
    },
}

const server = new ApolloServer({
    typeDefs,
    resolvers,
})

startStandaloneServer(server, {
    listen: {port: 4000},
}).then(({url}) => {
    console.log(`Server ready at ${url}`)
})
